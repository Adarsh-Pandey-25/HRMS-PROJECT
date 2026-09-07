const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError } = require('../utils/errors');
const { hashKey, timingSafeEqualHex } = require('./apiKey.service');
const emailService = require('./email.service');
const ipGeoService = require('./ipGeo.service');
const settingsService = require('./settings.service');
const auditLogService = require('./auditLog.service');
const logger = require('../utils/logger');

const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // Section D1: soft "stale" warning
const RATE_WINDOW_MS = 5 * 60 * 60 * 1000; // CHECK A: rolling 5h window
const RATE_THRESHOLD = 5; // 5+ changes in the window
const COMPROMISE_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // max once per 6h per beacon

/** Every HR/Admin at the company — same notify pattern as apiKey.service.js's notifyHrAdmins. */
const notifyHrAdmins = async (companyId, send) => {
  const { data: recipients } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('role', ['hr', 'admin']);
  for (const r of recipients || []) {
    send({ to: r.email, name: `${r.first_name} ${r.last_name}`.trim() }).catch((e) =>
      logger.warn('[IPBeacon] Notification email failed', { error: e.message }));
  }
};

// ── D1: Beacon management ───────────────────────────────────────────────

const listBeacons = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('ip_beacons')
    .select('id, label, beacon_key, is_active, expected_region, last_pushed_ip, last_pushed_at, created_at, revoked_at, linked_whitelist_entry_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);

  const now = Date.now();
  return (data || []).map((b) => ({
    ...b,
    health: !b.is_active
      ? 'revoked'
      : !b.last_pushed_at
        ? 'never_pinged'
        : (now - new Date(b.last_pushed_at).getTime() > STALE_AFTER_MS ? 'stale' : 'healthy'),
  }));
};

/**
 * Section D1: beacon_secret is returned ONCE, never retrievable again —
 * matches apiKey.service.js's issuance convention exactly (raw value shown
 * once, only the SHA-256 hash persisted).
 */
const createBeacon = async (companyId, { label, expectedRegion }, createdBy) => {
  if (!label || !String(label).trim()) throw new BadRequestError('Label is required');

  const beaconKey = `bcn_${crypto.randomBytes(8).toString('hex')}`;
  const beaconSecret = crypto.randomBytes(24).toString('hex');
  const secretHash = hashKey(beaconSecret);

  const { data, error } = await supabaseAdmin
    .from('ip_beacons')
    .insert({
      company_id: companyId, label: String(label).trim(), beacon_key: beaconKey,
      beacon_secret_hash: secretHash, expected_region: expectedRegion || null, created_by: createdBy,
    })
    .select('id, label, beacon_key, expected_region, created_at')
    .single();
  if (error) throw new BadRequestError(error.message);

  await auditLogService.logAudit({
    companyId, actorId: createdBy, actorRole: 'admin', actionType: 'beacon_created', targetType: 'ip_beacon', targetId: data.id,
    afterState: { label: data.label, beaconKey: data.beacon_key },
  });

  return { ...data, beaconSecret }; // only place the raw secret is ever returned
};

const revokeBeacon = async (companyId, beaconId, revokedBy) => {
  const { data, error } = await supabaseAdmin
    .from('ip_beacons')
    .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: revokedBy })
    .eq('id', beaconId)
    .eq('company_id', companyId)
    .select('id, label, linked_whitelist_entry_id')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Beacon not found');

  await auditLogService.logAudit({
    companyId, actorId: revokedBy, actorRole: 'admin', actionType: 'beacon_revoked', targetType: 'ip_beacon', targetId: data.id,
    afterState: { label: data.label },
  });
  // Deliberately NOT touching linked_whitelist_entry_id — stated explicitly
  // per instruction: revoking a beacon does not auto-remove its whitelist entry.
  return { revoked: true, whitelistEntryUntouched: Boolean(data.linked_whitelist_entry_id) };
};

// ── D2: Ping handling ────────────────────────────────────────────────────

/**
 * Resolves beacon_key -> row and verifies X-Beacon-Secret via constant-time
 * hash comparison. No company_id-scoped lookup path exists before this —
 * the key alone (globally unique) resolves the row, and cross-company use
 * is structurally impossible since every subsequent write is scoped to
 * THIS beacon's own company_id, never a caller-supplied one. Same
 * isolation rigor as ADMS device auth, deliberately not touching that
 * pipeline itself.
 */
const verifyBeaconAuth = async (beaconKey, providedSecret) => {
  if (!beaconKey) throw new UnauthorizedError('Beacon key is required');
  const { data: beacon, error } = await supabaseAdmin
    .from('ip_beacons')
    .select('*')
    .eq('beacon_key', beaconKey)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!beacon) throw new UnauthorizedError('Unknown beacon');

  if (!providedSecret || !timingSafeEqualHex(hashKey(providedSecret), beacon.beacon_secret_hash)) {
    throw new UnauthorizedError('Invalid beacon secret');
  }
  if (!beacon.is_active) throw new ForbiddenError('This beacon has been revoked');
  return beacon;
};

const recordAuditForBeacon = (beacon, actionType, afterState) =>
  auditLogService.logAudit({
    companyId: beacon.company_id, actorId: null, actorRole: 'system', actionType, targetType: 'ip_beacon', targetId: beacon.id, afterState,
  });

/** CHECK A: rate-based anomaly — 5+ IP changes in a rolling 5h window. */
const checkRateAnomaly = async (beacon) => {
  const since = moment().subtract(RATE_WINDOW_MS, 'milliseconds').toISOString();
  const { data: recentChanges, error } = await supabaseAdmin
    .from('ip_beacon_pings')
    .select('observed_ip, pinged_at')
    .eq('beacon_id', beacon.id)
    .eq('ip_changed', true)
    .gte('pinged_at', since)
    .order('pinged_at', { ascending: false });
  if (error) { logger.error('[IPBeacon] Rate-check query failed', { error: error.message }); return; }
  if ((recentChanges || []).length < RATE_THRESHOLD) return;

  const cooldownKey = `beacon_compromise_alert_${beacon.id}`;
  const lastAlertIso = await settingsService.getSetting(cooldownKey, null, beacon.company_id);
  const lastAlertAt = lastAlertIso ? new Date(lastAlertIso).getTime() : 0;
  if (Date.now() - lastAlertAt < COMPROMISE_ALERT_COOLDOWN_MS) return; // cooldown active — do not spam
  await settingsService.setSetting(cooldownKey, new Date().toISOString(), null, beacon.company_id);

  await notifyHrAdmins(beacon.company_id, (recipient) =>
    emailService.beaconCompromiseAlertEmail(recipient, beacon, recentChanges));
};

/** CHECK B: geo-mismatch guard — auto-applies on match, holds for approval on mismatch. */
const checkGeoAndApply = async (beacon, observedIp) => {
  const detected = ipGeoService.lookupRegion(observedIp);
  const matches = ipGeoService.regionsMatch(beacon.expected_region, detected);

  if (matches) {
    await applyNewIp(beacon, observedIp, { auditNote: 'geo_match_auto_applied' });
    return { applied: true, detected };
  }

  const { error } = await supabaseAdmin.from('ip_beacon_pending_approvals').insert({
    beacon_id: beacon.id, proposed_ip: observedIp, detected_region: detected?.label || null, reason: 'geo_mismatch',
  });
  if (error) logger.error('[IPBeacon] Failed to create pending approval', { error: error.message });

  await notifyHrAdmins(beacon.company_id, (recipient) =>
    emailService.beaconGeoMismatchEmail(recipient, beacon, { proposedIp: observedIp, detectedRegion: detected?.label }));

  return { applied: false, detected };
};

/** Applies a new IP to the beacon's linked whitelist entry (creating one on first ping). */
const applyNewIp = async (beacon, newIp, { auditNote } = {}) => {
  let whitelistEntryId = beacon.linked_whitelist_entry_id;
  const oldIp = beacon.last_pushed_ip;

  if (!whitelistEntryId) {
    const { data: entry, error } = await supabaseAdmin
      .from('ip_whitelist')
      .insert({ company_id: beacon.company_id, cidr: newIp, label: `Beacon: ${beacon.label}`, created_by: beacon.created_by })
      .select('id')
      .single();
    if (error) throw new BadRequestError(error.message);
    whitelistEntryId = entry.id;
  } else {
    const { error } = await supabaseAdmin.from('ip_whitelist').update({ cidr: newIp, updated_at: new Date().toISOString() }).eq('id', whitelistEntryId);
    if (error) throw new BadRequestError(error.message);
  }

  await supabaseAdmin
    .from('ip_beacons')
    .update({ linked_whitelist_entry_id: whitelistEntryId, last_pushed_ip: newIp, last_pushed_at: new Date().toISOString() })
    .eq('id', beacon.id);

  await recordAuditForBeacon(beacon, 'beacon_ip_applied', { oldIp, newIp, note: auditNote });
  return whitelistEntryId;
};

/**
 * D2: the full ping pipeline. Rate-limited at the ROUTE layer (see
 * ipBeaconPing.routes.js) — max once per 30s per beacon.
 */
/**
 * Section D2 gap fix: the ping endpoint has no `authenticate`/`requireFeature`
 * middleware (it's hit by a physical device, not a logged-in employee — see
 * ipBeaconPing.routes.js), so a beacon whose company later turns
 * ip_based_web off (super-admin revokes the entitlement, or the company
 * itself flips its own Check-in Methods toggle) kept silently processing
 * pings and updating the whitelist in the background forever, with no way
 * to actually stop it short of revoking the beacon's credentials outright.
 * Checked here, after auth (so a wrong secret still 401s before this ever
 * runs — never leak entitlement state to a bad credential) but before any
 * ping is recorded or acted on. Deliberately does NOT touch the beacon
 * row itself — its config/credentials stay intact so it resumes working
 * the instant the entitlement/toggle is back on, no re-registration needed.
 */
const assertIpBasedWebActive = async (beacon) => {
  const featureOverrideService = require('./featureOverride.service');
  const entitled = await featureOverrideService.hasFeature(beacon.company_id, 'ip_based_web');
  if (!entitled) throw new ForbiddenError('IP-based check-in is not enabled for this company');

  const attendanceService = require('./attendance.service');
  const config = await attendanceService.getAttendanceConfig(beacon.company_id);
  if (config.methods?.ipWeb === false) {
    throw new ForbiddenError('IP-based check-in is not enabled for this company');
  }
};

const recordPing = async (beaconKey, providedSecret, observedIp) => {
  if (!observedIp) throw new BadRequestError('Could not resolve caller IP');
  const beacon = await verifyBeaconAuth(beaconKey, providedSecret);
  await assertIpBasedWebActive(beacon);

  const isFirstPing = !beacon.last_pushed_at;
  const ipChanged = !isFirstPing && beacon.last_pushed_ip !== observedIp;

  const { error: pingError } = await supabaseAdmin.from('ip_beacon_pings').insert({
    beacon_id: beacon.id, observed_ip: observedIp, ip_changed: ipChanged,
  });
  if (pingError) logger.error('[IPBeacon] Failed to record ping', { error: pingError.message });

  if (isFirstPing) {
    await applyNewIp(beacon, observedIp, { auditNote: 'first_ping' });
    await notifyHrAdmins(beacon.company_id, (recipient) => emailService.beaconFirstPingEmail(recipient, beacon, observedIp));
    return { status: 'first_ping_whitelisted', ip: observedIp };
  }

  if (!ipChanged) {
    await supabaseAdmin.from('ip_beacons').update({ last_pushed_at: new Date().toISOString() }).eq('id', beacon.id);
    return { status: 'heartbeat' };
  }

  // Changed IP — BOTH checks run; rate-check never blocks the geo-check.
  await checkRateAnomaly(beacon);
  const { applied, detected } = await checkGeoAndApply(beacon, observedIp);
  return { status: applied ? 'ip_applied' : 'pending_approval', detectedRegion: detected?.label || null };
};

// ── D2: pending approvals ────────────────────────────────────────────────

const listPendingApprovals = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('ip_beacon_pending_approvals')
    .select('*, ip_beacons!inner(id, label, company_id, expected_region)')
    .eq('ip_beacons.company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const resolvePendingApproval = async (companyId, approvalId, decision, resolvedBy) => {
  if (!['approved', 'rejected'].includes(decision)) throw new BadRequestError('decision must be approved or rejected');

  const { data: approval, error } = await supabaseAdmin
    .from('ip_beacon_pending_approvals')
    .select('*, ip_beacons!inner(*)')
    .eq('id', approvalId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!approval) throw new NotFoundError('Pending approval not found');
  const beacon = approval.ip_beacons;
  if (beacon.company_id !== companyId) throw new NotFoundError('Pending approval not found');

  if (decision === 'approved') {
    await applyNewIp(beacon, approval.proposed_ip, { auditNote: 'geo_mismatch_manually_approved' });
  }

  await supabaseAdmin
    .from('ip_beacon_pending_approvals')
    .update({ status: decision, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq('id', approvalId);

  await auditLogService.logAudit({
    companyId, actorId: resolvedBy, actorRole: 'admin', actionType: `beacon_pending_ip_${decision}`,
    targetType: 'ip_beacon_pending_approval', targetId: approvalId, afterState: { proposedIp: approval.proposed_ip, beaconLabel: beacon.label },
  });

  return { resolved: true, decision };
};

module.exports = {
  listBeacons, createBeacon, revokeBeacon, recordPing, listPendingApprovals, resolvePendingApproval,
  RATE_THRESHOLD, RATE_WINDOW_MS,
};
