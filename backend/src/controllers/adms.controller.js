const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { successResponse, isMissingColumnError, getTrustedClientIp } = require('../utils/helpers');
const { ForbiddenError, BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const admsService = require('../services/adms.service');
const featureOverrideService = require('../services/featureOverride.service');
const { auditFromRequest } = require('../services/auditLog.service');

/**
 * What every /iclock request is checked with. The secret is read only from
 * the X-Device-Secret header — never the query string, which access logs
 * record. The IP is the trusted one (helpers.getTrustedClientIp).
 */
const deviceRequest = (req) => ({
  deviceSerial: typeof req.query.SN === 'string' ? req.query.SN : null,
  providedSecret: typeof req.headers['x-device-secret'] === 'string' ? req.headers['x-device-secret'] : null,
  clientIp: getTrustedClientIp(req),
});

/**
 * Heartbeats and device info go through the same check as punches, so the
 * real device usually pins its IP on its first heartbeat after
 * registration. A request that fails it still gets a plain OK (the protocol
 * expects one), but no last-seen update and no command, so it can't make a
 * device look online or create a row for an unknown serial.
 */
const isAuthorizedDevice = async ({ deviceSerial, providedSecret, clientIp }, kind) => {
  try {
    await admsService.assertDeviceAuthorized(deviceSerial, providedSecret, clientIp);
    return true;
  } catch (err) {
    logger.info(`[ADMS] ${kind} not accepted`, { deviceSerial: String(deviceSerial || '').slice(0, 64), ip: clientIp, reason: err.message });
    return false;
  }
};

/**
 * Device sends this every ~30s. No auth — the eSSL protocol can't send any.
 * Responding with an ATTLOG command nudges the device to push any punches
 * it's holding on the very next request instead of waiting on its own timer.
 */
const getrequest = async (req, res) => {
  const request = deviceRequest(req);
  if (await isAuthorizedDevice(request, 'Heartbeat')) {
    logger.info('[ADMS] Heartbeat', { deviceSerial: request.deviceSerial });
    await admsService.touchHeartbeat(request.deviceSerial);
    return res.status(200).type('text/plain').send('OK\nGetRequest:ATTLOG');
  }
  res.status(200).type('text/plain').send('OK');
};

/** Device sends this once on first connect. No auth. */
const deviceinfo = async (req, res) => {
  const request = deviceRequest(req);
  // Unauthenticated, attacker-controlled input — log a capped preview only, never the raw body verbatim.
  const bodyPreview = String(req.body || '').slice(0, 200);
  if (await isAuthorizedDevice(request, 'Device info')) {
    logger.info('[ADMS] Device info', { deviceSerial: request.deviceSerial, bodyLength: String(req.body || '').length, bodyPreview });
    await admsService.touchHeartbeat(request.deviceSerial);
  }
  res.status(200).type('text/plain').send('OK');
};

/**
 * Device pushes fingerprint punches here. No protocol-level auth — but
 * unlike benign save failures (which always answer OK to avoid a
 * retry-storm), an authorization rejection (unclaimed serial, wrong/missing
 * device secret) is a genuine "reject" — 403/401 "NOK" — which the device
 * treats as a failed upload. Unregistered/secret rejections alert platform
 * admins.
 *
 * A registered device calling from an IP it isn't pinned to (the office's
 * internet address changed) has its punches kept instead — told OK, they
 * count once someone approves the new IP (admsIpApproval.service.js; the
 * approvers are told by adms.service.js recordPendingIp). Before that
 * migration runs, or if they can't be kept, the push is refused with NOK
 * as before.
 */
const cdata = async (req, res) => {
  const request = deviceRequest(req);
  const { deviceSerial, clientIp } = request;
  const table = req.query.table || null;

  let registeredCompanyId;
  try {
    registeredCompanyId = await admsService.assertDeviceAuthorized(deviceSerial, request.providedSecret, clientIp);
  } catch (err) {
    if (err.deviceIpMismatch) {
      const kept = await admsService.keepPushFromNewIp(err.device, clientIp, table, req.body).catch((e) => {
        logger.error('[ADMS] Could not keep a push from a new IP', { deviceSerial: String(deviceSerial || '').slice(0, 64), error: e.message });
        return false;
      });
      if (kept) return res.status(200).type('text/plain').send('OK');
    }
    const status = err.statusCode || 403;
    logger.warn('[ADMS] Rejected unauthorized cdata push', {
      deviceSerial: String(deviceSerial || '').slice(0, 64), ip: clientIp, status, reason: err.message,
    });
    if (!err.deviceIpMismatch) {
      await admsService.alertOnUnauthorizedDevice(deviceSerial, err.message, { ip: clientIp }).catch((e) => {
        logger.error('[ADMS] alertOnUnauthorizedDevice failed', { error: e.message });
      });
    }
    return res.status(status).type('text/plain').send('NOK');
  }

  try {
    if (table !== 'ATTLOG') {
      logger.info('[ADMS] Ignoring non-ATTLOG cdata push', { deviceSerial, table });
      return res.status(200).type('text/plain').send('OK');
    }

    const punches = admsService.parseAttlogBody(req.body, deviceSerial);
    logger.info('[ADMS] Punch data received', { deviceSerial, lineCount: punches.length });

    const { inserted } = await admsService.savePunches(punches, deviceSerial, registeredCompanyId);
    logger.info('[ADMS] Punches saved', { deviceSerial, inserted });
  } catch (err) {
    logger.error('[ADMS] cdata handler failed', { deviceSerial, error: err.message });
  }

  res.status(200).type('text/plain').send('OK');
};

/** Authenticated: HR/Admin dashboard check on the ADMS pipeline. */
const testStatus = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;

    const [
      { data: recentPunches, error: recentError },
      { data: heartbeats, error: heartbeatsError },
      { count: todayCount, error: todayError },
    ] = await Promise.all([
      supabaseAdmin
        .from('device_punches')
        .select('id, device_user_id, employee_id, punch_time, punch_type, verify_mode, device_serial')
        .eq('company_id', companyId)
        .order('punch_time', { ascending: false })
        .limit(5),
      (async () => {
        const query = (columns) => supabaseAdmin
          .from('device_heartbeats')
          .select(columns)
          .eq('company_id', companyId)
          .order('last_seen_at', { ascending: false });
        const result = await query('device_serial, last_seen_at, name, location, allowed_ip, pending_ip, pending_ip_seen_at, ip_pinned_at');
        // Before 20261117_adms_device_ip_pinning.sql runs: list devices without their IP details.
        if (result.error && admsService.isMissingPinColumn(result.error.message)) {
          return query('device_serial, last_seen_at, name, location');
        }
        return result;
      })(),
      (async () => {
        const { start, end } = admsService.todayRangeIso();
        return supabaseAdmin
          .from('device_punches')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .gte('punch_time', start)
          .lte('punch_time', end);
      })(),
    ]);

    if (recentError) throw recentError;
    if (heartbeatsError) throw heartbeatsError;
    if (todayError) throw todayError;

    // Punches kept from a waiting new IP (admsIpApproval.service.js).
    const ipApproval = require('../services/admsIpApproval.service');
    const keepsPunches = await ipApproval.keepingAvailable().catch(() => false);
    const kept = await Promise.all((heartbeats || []).map((h) => (keepsPunches && h.pending_ip
      ? ipApproval.keptSummary(h.device_serial, companyId, h.pending_ip).catch(() => ({ count: 0, sinceIso: null }))
      : { count: 0, sinceIso: null })));

    successResponse(res, 'ADMS status', {
      supabaseConnected: true,
      recentPunches: recentPunches || [],
      todayPunchCount: todayCount || 0,
      keepsPunches,
      devices: (heartbeats || []).map((h, i) => ({
        deviceSerial: h.device_serial,
        lastSeenAt: h.last_seen_at,
        name: h.name,
        location: h.location,
        allowedIp: h.allowed_ip ?? null,
        pendingIp: h.pending_ip ?? null,
        pendingIpSeenAt: h.pending_ip_seen_at ?? null,
        ipPinnedAt: h.ip_pinned_at ?? null,
        keptPunches: kept[i].count,
        keptSince: kept[i].sinceIso,
      })),
    });
  } catch (err) { next(err); }
};

/**
 * Authenticated: HR/Admin registers or relabels a device by serial — this is
 * the only way a device ever gets associated with a company. Any device
 * serial works (typed by the admin from whatever's printed on their unit);
 * nothing in the codebase assumes a specific make/model/serial.
 *
 * - Serial never seen before -> claimed for this company now.
 * - Serial already claimed by this company -> just updates name/location.
 * - Serial already claimed by a DIFFERENT company -> rejected. The device
 *   itself is unauthenticated (the ADMS protocol has no way to prove
 *   ownership), so first-to-register is the only enforceable rule; this at
 *   least stops one tenant from silently taking over another's device entry.
 */
const registerDevice = async (req, res, next) => {
  try {
    const { serial } = req.params;
    const { name, location } = req.body || {};
    if (!serial) throw new BadRequestError('Device serial is required');
    if (!admsService.isValidDeviceSerial(serial)) {
      throw new BadRequestError('Device serial can only contain letters, numbers, dots, dashes and underscores');
    }
    const companyId = req.user.company_id;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial, last_seen_at, name, location, company_id')
      .eq('device_serial', serial)
      .maybeSingle();
    if (findError) throw findError;

    if (existing?.company_id && existing.company_id !== companyId) {
      throw new ConflictError('This device is already registered to another company');
    }

    // Security audit finding: a released device (company_id nulled by
    // releaseDevice) being reclaimed here — by this same company or a
    // different one, first-to-register — starts a NEW ownership window.
    // claimed_at marks that boundary so deviceMapping.controller.js's
    // punch/device-user queries never surface data from BEFORE this claim,
    // whether that's another tenant's history on a resold unit or this same
    // company's own stale pre-release data. Untouched when the row is
    // already owned by this company (existing.company_id === companyId) —
    // a plain name/location edit must not reset the claim boundary.
    const isFreshClaim = !existing?.company_id;

    // The claimed_at column (migration 20260907_device_heartbeats_claimed_at.sql)
    // needs applying manually via the Supabase SQL editor. Retries without it
    // on a missing-column error so registering/updating a device doesn't 500
    // in the interim — same per-call fallback used in deviceMapping.controller.js
    // for the read side of this same migration.
    const claimedAtPatch = isFreshClaim ? { claimed_at: new Date().toISOString() } : {};

    if (existing) {
      let { data: updated, error: updateError } = await supabaseAdmin
        .from('device_heartbeats')
        .update({ name: name ?? null, location: location ?? null, company_id: companyId, ...claimedAtPatch })
        .eq('device_serial', serial)
        .select('device_serial, last_seen_at, name, location')
        .single();
      if (updateError && isMissingColumnError(updateError.message, 'claimed_at')) {
        ({ data: updated, error: updateError } = await supabaseAdmin
          .from('device_heartbeats')
          .update({ name: name ?? null, location: location ?? null, company_id: companyId })
          .eq('device_serial', serial)
          .select('device_serial, last_seen_at, name, location')
          .single());
      }
      if (updateError) throw updateError;
      // A new owner's device learns its IP afresh on its next request.
      if (isFreshClaim) await admsService.clearDeviceIpPin(serial);
      return successResponse(res, 'Device updated', {
        deviceSerial: updated.device_serial,
        lastSeenAt: updated.last_seen_at,
        name: updated.name,
        location: updated.location,
      });
    }

    // Device hasn't pinged yet — pre-register it so it's claimed the moment it does.
    let { data: created, error: insertError } = await supabaseAdmin
      .from('device_heartbeats')
      .insert({ device_serial: serial, name: name ?? null, location: location ?? null, company_id: companyId, ...claimedAtPatch })
      .select('device_serial, last_seen_at, name, location')
      .single();
    if (insertError && isMissingColumnError(insertError.message, 'claimed_at')) {
      ({ data: created, error: insertError } = await supabaseAdmin
        .from('device_heartbeats')
        .insert({ device_serial: serial, name: name ?? null, location: location ?? null, company_id: companyId })
        .select('device_serial, last_seen_at, name, location')
        .single());
    }
    if (insertError) throw insertError;

    successResponse(res, 'Device registered', {
      deviceSerial: created.device_serial,
      lastSeenAt: created.last_seen_at,
      name: created.name,
      location: created.location,
    }, null, 201);
  } catch (err) { next(err); }
};

/**
 * Authenticated: HR/Admin releases a device its own company currently owns —
 * the counterpart to registerDevice's "first-to-register" claim. Without
 * this, a resold/redistributed physical device stays permanently bound to
 * its original company (registerDevice rejects any other company's claim
 * outright, see the comment there) with no self-service handoff path.
 *
 * Also purges this company's device_employee_mapping rows for the serial —
 * those numeric-device-ID mappings only make sense in the context of the
 * company that owned the device. Leaving them in place after release would
 * both block whoever claims the serial next from ever mapping that
 * device_user_id (UNIQUE(device_user_id, device_serial)) and leak this
 * company's employee names/codes to them via a live join — the same
 * cross-tenant identity leak pattern closed for employee transfers in
 * employee.controller.js's update().
 */
const releaseDevice = async (req, res, next) => {
  try {
    const { serial } = req.params;
    if (!serial) throw new BadRequestError('Device serial is required');
    const companyId = req.user.company_id;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial, company_id')
      .eq('device_serial', serial)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing || existing.company_id !== companyId) {
      throw new NotFoundError('Device not found — register it under Settings > Attendance first');
    }

    const { error: mappingError } = await supabaseAdmin
      .from('device_employee_mapping')
      .delete()
      .eq('device_serial', serial);
    if (mappingError) throw mappingError;

    const { error: releaseError } = await supabaseAdmin
      .from('device_heartbeats')
      .update({ company_id: null, name: null, location: null })
      .eq('device_serial', serial);
    if (releaseError) throw releaseError;
    await admsService.clearDeviceIpPin(serial);

    successResponse(res, 'Device released');
  } catch (err) { next(err); }
};

/**
 * Authenticated: HR/Admin allows the IP a device is now reporting from
 * (its pending_ip). The body carries the IP the admin was shown; if a
 * different one arrived since, nothing changes (409).
 */
const allowDeviceNewIp = async (req, res, next) => {
  try {
    const result = await admsService.allowPendingDeviceIp(req.params.serial, req.user.company_id, req.body?.ip, { decidedBy: req.user.id });
    auditFromRequest(req, {
      actionType: 'biometric_device.allow_new_ip',
      targetType: 'biometric_device',
      targetId: result.deviceSerial,
      beforeState: { allowed_ip: result.previousIp },
      afterState: { allowed_ip: result.allowedIp },
    });
    const keptNote = result.keptPunches
      ? ` ${result.keptPunches === 1 ? 'The punch' : `The ${result.keptPunches} punches`} kept since ${result.keptSince} ${result.keptPunches === 1 ? 'is' : 'are'} being added now.`
      : '';
    successResponse(res, `Punches from ${result.allowedIp} will now be accepted for this device.${keptNote}`, result);
  } catch (err) { next(err); }
};

/**
 * Authenticated: HR/Admin rejects the IP a device is reporting from (its
 * pending_ip). Its punches from there stay kept, never counted; nobody is
 * asked about it again for 7 days. Same `ip` check as Allow new IP.
 */
const rejectDeviceNewIp = async (req, res, next) => {
  try {
    const result = await admsService.rejectPendingDeviceIp(req.params.serial, req.user.company_id, req.body?.ip, { decidedBy: req.user.id });
    auditFromRequest(req, {
      actionType: 'biometric_device.reject_new_ip',
      targetType: 'biometric_device',
      targetId: result.deviceSerial,
      afterState: { rejected_ip: result.rejectedIp, allowed_ip: result.allowedIp },
    });
    successResponse(res, `${result.rejectedIp} was rejected. Its punches stay kept but are not counted.`, result);
  } catch (err) { next(err); }
};

/** Authenticated: who is asked to approve a device's new IP (admsIpApproval.service.js). */
const getIpApprovers = async (req, res, next) => {
  try {
    const value = await require('../services/admsIpApproval.service').getApprovers(req.user.company_id);
    successResponse(res, 'New IP approvers', value);
  } catch (err) { next(err); }
};

const saveIpApprovers = async (req, res, next) => {
  try {
    const ipApproval = require('../services/admsIpApproval.service');
    const before = await ipApproval.getApprovers(req.user.company_id);
    const value = await ipApproval.saveApprovers(req.user.company_id, req.body || {}, req.user.id);
    auditFromRequest(req, {
      actionType: 'biometric_device.ip_approvers_changed',
      targetType: 'setting',
      targetId: ipApproval.APPROVERS_KEY,
      beforeState: before,
      afterState: value,
    });
    successResponse(res, 'Saved who approves a new IP', value);
  } catch (err) { next(err); }
};

/** Authenticated: HR/Admin clears a device's pinned IP; its next request pins a new one. */
const relearnDeviceIp = async (req, res, next) => {
  try {
    const result = await admsService.relearnDeviceIp(req.params.serial, req.user.company_id);
    auditFromRequest(req, {
      actionType: 'biometric_device.relearn_ip',
      targetType: 'biometric_device',
      targetId: result.deviceSerial,
      beforeState: { allowed_ip: result.previousIp },
      afterState: { allowed_ip: null },
    });
    successResponse(res, 'The device will be pinned to the IP of its next request', result);
  } catch (err) { next(err); }
};

/** Authenticated: today's raw punches for one employee (self, or another employee if HR/manager scope allows). */
const todayPunches = async (req, res, next) => {
  try {
    const targetEmployeeId = req.query.employee_id || req.user.id;

    if (targetEmployeeId !== req.user.id) {
      if (!['admin', 'hr', 'manager'].includes(req.user.role)) {
        throw new ForbiddenError('Not allowed to view this employee\'s punches');
      }
      // Same company/team scope every other attendance endpoint enforces —
      // a client-supplied employee_id must never reach across tenants or
      // outside a manager's own reports.
      const tenantService = require('../services/tenant.service');
      const attendanceService = require('../services/attendance.service');
      const allowedIds = ['admin', 'hr'].includes(req.user.role)
        ? await tenantService.getOrgEmployeeIds(req.user.company_id)
        : await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
      if (!allowedIds.includes(targetEmployeeId)) {
        throw new NotFoundError('Employee not found');
      }
    }

    // Item 8: this endpoint is exclusively biometric content (raw device_punches),
    // unlike the mixed attendance-row endpoints elsewhere — when the company
    // can't see biometric data at all, this returns empty rather than a
    // 403, matching item 8B's "the company should have no way to discover
    // this exists" philosophy applied here too.
    if (!(await featureOverrideService.hasFeature(req.user.company_id, 'biometric_adms'))) {
      successResponse(res, 'Today\'s device punches', []);
      return;
    }

    const { start, end } = admsService.todayRangeIso();
    const { data, error } = await supabaseAdmin
      .from('device_punches')
      .select('id, device_user_id, employee_id, punch_time, punch_type, verify_mode, device_serial')
      .eq('employee_id', targetEmployeeId)
      .gte('punch_time', start)
      .lte('punch_time', end)
      .order('punch_time', { ascending: true });

    if (error) throw error;
    successResponse(res, 'Today\'s device punches', data || []);
  } catch (err) { next(err); }
};

module.exports = {
  getrequest,
  deviceinfo,
  cdata,
  testStatus,
  registerDevice,
  releaseDevice,
  allowDeviceNewIp,
  rejectDeviceNewIp,
  relearnDeviceIp,
  getIpApprovers,
  saveIpApprovers,
  todayPunches,
};
