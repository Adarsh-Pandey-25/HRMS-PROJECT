const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { runInBackground } = require('../utils/background');
const { TIMEZONE } = require('../utils/constants');
const {
  getShiftDayWindow, normalizeIp, ipInCidr, isTrustedProxyIp, isMissingColumnError, escapeHtml,
} = require('../utils/helpers');
const {
  ForbiddenError, UnauthorizedError, BadRequestError, NotFoundError, ConflictError,
} = require('../utils/errors');

/** eSSL ADMS ATTLOG status codes -> our punch_type. */
const STATUS_TO_PUNCH_TYPE = {
  0: 'checkin',
  1: 'checkout',
  4: 'overtime_in',
  5: 'overtime_out',
};

/** eSSL ADMS ATTLOG verify codes -> our verify_mode. */
const VERIFY_TO_MODE = {
  0: 'fingerprint',
  1: 'password',
  2: 'card',
  15: 'face',
};

/** Only called once a request has passed assertDeviceAuthorized — never creates a row for an unknown serial. */
const touchHeartbeat = async (deviceSerial) => {
  if (!deviceSerial) return;
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('device_serial', deviceSerial);
  if (error) logger.error('[ADMS] Failed to record heartbeat', { deviceSerial, error: error.message });
};

/** Device serials are letters and digits (eSSL/ZKTeco, e.g. NFZ8244800715), sometimes with - _ or . */
const SERIAL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const isValidDeviceSerial = (serial) => typeof serial === 'string' && SERIAL_PATTERN.test(serial);

const DEVICE_COLUMNS = 'device_serial, company_id, name, location, device_secret, allowed_ip, pending_ip, pending_ip_seen_at, ip_pinned_at';
const PIN_COLUMNS = ['allowed_ip', 'pending_ip', 'pending_ip_seen_at', 'ip_pinned_at'];
const isMissingPinColumn = (message) => [...PIN_COLUMNS, 'device_secret'].some((c) => isMissingColumnError(message, c));
const MIGRATION_FILE = 'supabase/migrations/20261117_adms_device_ip_pinning.sql';

/**
 * Fails closed when the IP-pinning columns are missing: devices keep any
 * punch the server refuses and send it again, so nothing is lost while the
 * migration waits — whereas accepting would reopen the hole it closes.
 */
const loadDevice = async (deviceSerial) => {
  const { data, error } = await supabaseAdmin
    .from('device_heartbeats')
    .select(DEVICE_COLUMNS)
    .eq('device_serial', deviceSerial)
    .maybeSingle();
  if (error) {
    if (isMissingPinColumn(error.message)) {
      logger.error(`[ADMS] Device IP pinning columns are missing. Run ${MIGRATION_FILE}. Device pushes are refused until then; devices keep their punches and resend them.`, { deviceSerial });
      throw new ForbiddenError('Device IP pinning is not set up on the server yet (database migration pending)');
    }
    logger.error('[ADMS] Device authorization lookup failed', { deviceSerial, error: error.message });
    throw new ForbiddenError('Device is not registered');
  }
  return data || null;
};

/** Constant-time comparison; hashing first makes the lengths equal, so no length leak either. */
const deviceSecretMatches = (expected, provided) => {
  if (typeof provided !== 'string' || !provided) return false;
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(a, b);
};

/**
 * "New IP" emails to a company's admins: at most one per device per hour,
 * even if someone keeps sending from different IPs. In memory (one server
 * today); the pending_ip comparison below is what keeps it to once per new
 * IP across restarts.
 */
const NEW_IP_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const newIpAlertSentAt = new Map();

/**
 * Subject and HTML for the "device reporting from a new IP" email. Every
 * device-supplied value is escaped. `kept`: its punches from the new IP are
 * kept until someone approves it (admsIpApproval.service.js), not refused.
 */
const deviceNewIpEmail = ({ deviceSerial, name, location, allowedIp, newIp, kept = false }) => {
  const label = name ? `${name} (${deviceSerial})` : deviceSerial;
  const whatHappens = kept
    ? `<p>Its punches from the new IP are being kept, not counted. Once the new IP is approved they count, at the times they were made, so nothing is lost.</p>
<p>If your office's internet connection changed (new provider, router restart with a new public IP), approve it: tap <strong>Approve</strong> on the WhatsApp message, or open <strong>Settings → Attendance → Biometric Devices</strong> and choose <strong>Allow new IP</strong>.</p>`
    : `<p>Punches from the new IP are being refused until it is allowed. Most devices keep them and send them again, but not every device does, so please act soon.</p>
<p>If your office's internet connection changed (new provider, router restart with a new public IP), open <strong>Settings → Attendance → Biometric Devices</strong> and choose <strong>Allow new IP</strong> for this device.</p>`;
  return {
    subject: `Biometric device ${String(name || deviceSerial).slice(0, 60)} is reporting from a new IP`,
    html: `<p>Your biometric device <strong>${escapeHtml(label)}</strong>${location ? ` at ${escapeHtml(location)}` : ''} sent a request from an IP address it is not allowed to use.</p>
<p>Allowed IP: <code>${escapeHtml(allowedIp || 'none')}</code><br>New IP: <code>${escapeHtml(newIp)}</code></p>
${whatHappens}
<p>If nothing changed at your office, do not allow it${kept ? ' (on WhatsApp, tap Reject)' : ''}: someone may be using this device's serial number to send fake attendance. Contact SpaxSync support.</p>`,
  };
};

/**
 * Tells the people chosen to approve a new IP (Settings → Attendance →
 * Biometric Devices; every HR and Admin by default) by email, and — once
 * punches can be kept — on WhatsApp with Approve / Reject
 * (admsIpApproval.service.js). Nobody chosen has an email: the admins, then
 * HR, as before.
 */
const alertAdminsOfNewDeviceIp = async (device, newIp) => {
  const last = newIpAlertSentAt.get(device.device_serial) || 0;
  if (Date.now() - last < NEW_IP_ALERT_COOLDOWN_MS) return;
  newIpAlertSentAt.set(device.device_serial, Date.now());

  const ipApproval = require('./admsIpApproval.service');
  const kept = await ipApproval.keepingAvailable().catch(() => false);
  const approvers = await ipApproval.approverEmployees(device.company_id).catch(() => []);
  const recipientsService = require('./emailRecipients.service');
  let recipients = approvers.filter((a) => a.email);
  if (!recipients.length) recipients = await recipientsService.getAdminEmailRecipients(device.company_id).catch(() => []);
  if (!recipients.length) recipients = await recipientsService.getHrEmailRecipients(device.company_id).catch(() => []);
  if (!recipients.length) {
    logger.warn('[ADMS] No admin to tell about a device reporting from a new IP', { deviceSerial: device.device_serial, companyId: device.company_id });
  }

  const { sendEmail } = require('./email.service');
  const { subject, html } = deviceNewIpEmail({
    deviceSerial: device.device_serial, name: device.name, location: device.location, allowedIp: device.allowed_ip, newIp, kept,
  });
  for (const r of recipients) {
    Promise.resolve()
      .then(() => sendEmail({ type: 'adms_device_new_ip', to: r.email, subject, html }))
      .catch((e) => logger.error('[ADMS] Failed to send new-IP email', { deviceSerial: device.device_serial, error: e.message }));
  }

  if (!kept || !approvers.length) return;
  const opened = await ipApproval.openRequest(device, newIp).catch(() => null);
  if (!opened) return;
  ipApproval.askOnWhatsapp(device, opened.request, approvers)
    .catch((e) => logger.error('[ADMS] Could not ask on WhatsApp about a new device IP', { deviceSerial: device.device_serial, error: e.message }));
};

/**
 * Writes pending_ip (only when it changed, so a retrying device writes once)
 * and tells the approvers. An IP someone rejected in the last 7 days stays
 * rejected: its punches are still kept, but nobody is asked again.
 */
const recordPendingIp = async (device, ip) => {
  if (normalizeIp(device.pending_ip) === ip) return;
  const ipApproval = require('./admsIpApproval.service');
  if (await ipApproval.recentlyRejected(device, ip).catch(() => false)) return;
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ pending_ip: ip, pending_ip_seen_at: new Date().toISOString() })
    .eq('device_serial', device.device_serial)
    .eq('company_id', device.company_id);
  if (error) {
    logger.error('[ADMS] Could not record a device\'s new IP', { deviceSerial: device.device_serial, error: error.message });
    return;
  }
  const keeping = await ipApproval.keepingAvailable().catch(() => false);
  logger.warn(`[ADMS] Device ${device.device_serial} (company ${device.company_id}) is pinned to ${device.allowed_ip} but called from ${ip}. Its punches are ${keeping ? 'kept, not counted' : 'refused'}; ${ip} is recorded as the pending IP until someone approves it ("Allow new IP", WhatsApp) or chooses "Re-learn IP".`, {
    deviceSerial: device.device_serial, companyId: device.company_id, allowedIp: device.allowed_ip, newIp: ip,
  });
  await alertAdminsOfNewDeviceIp(device, ip).catch((e) => logger.error('[ADMS] New-IP alert failed', { error: e.message }));
};

/**
 * Source-IP pinning — the eSSL push protocol can't carry a login or custom
 * header, so the device's public IP is the one thing a person who only knows
 * the serial can't fake. A registered device with no allowed_ip yet pins
 * the IP of its first request; after that, requests from any other IP are
 * refused and the IP is held as pending_ip for an Admin to allow.
 */
const assertDeviceIpAllowed = async (device, clientIp) => {
  const ip = normalizeIp(clientIp);
  if (!ip) throw new ForbiddenError('Could not tell which IP the device is calling from');
  // A Cloudflare edge address is shared by everyone routed through it — never pin or accept one.
  if (isTrustedProxyIp(ip)) throw new ForbiddenError('Could not tell the device\'s own IP (only a proxy address was seen)');

  let current = device;
  if (!current.allowed_ip) {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('device_heartbeats')
      .update({ allowed_ip: ip, ip_pinned_at: now, pending_ip: null, pending_ip_seen_at: null })
      .eq('device_serial', current.device_serial)
      .eq('company_id', current.company_id)
      .is('allowed_ip', null)
      .select('device_serial, allowed_ip');
    if (error) {
      logger.error('[ADMS] Could not pin the device IP', { deviceSerial: current.device_serial, error: error.message });
      throw new ForbiddenError('Could not record the device IP');
    }
    if (data && data.length) {
      logger.info(`[ADMS] Device ${current.device_serial} pinned to IP ${ip} on its first contact`, {
        deviceSerial: current.device_serial, companyId: current.company_id, ip,
      });
      // After "Re-learn IP": punches kept from this IP now count.
      const pinned = { ...current, allowed_ip: ip };
      runInBackground('kept punches after a re-learned IP', () => require('./admsIpApproval.service').afterAllowed(pinned, ip, { via: 'relearn' }));
      return;
    }
    // Another request pinned it between our read and our write — check against that.
    current = await loadDevice(current.device_serial);
    if (!current?.company_id || current.company_id !== device.company_id || !current.allowed_ip) {
      throw new ForbiddenError('Device is not registered to a company');
    }
  }

  if (ipInCidr(ip, current.allowed_ip)) return;

  await recordPendingIp(current, ip);
  const err = new ForbiddenError('Device is calling from an IP that is not allowed for it');
  err.deviceIpMismatch = true;
  // What keepPushFromNewIp needs (never the device secret).
  err.device = {
    device_serial: current.device_serial,
    company_id: current.company_id,
    name: current.name,
    location: current.location,
    allowed_ip: current.allowed_ip,
  };
  throw err;
};

/**
 * The ADMS protocol has no auth of its own — this is the only gate between
 * "anyone who knows the serial printed on a device" and a real attendance
 * write that flows into payroll. In order:
 *  1. The serial must be well-formed and claimed to a company via
 *     registerDevice (device_heartbeats.company_id set). An unclaimed serial
 *     has no tenant to attribute punches to, so it's rejected outright.
 *  2. If the device has a device_secret, the X-Device-Secret header must
 *     match it (compared in constant time; never read from the URL, where
 *     access logs would record it).
 *  3. The request must come from the device's pinned IP (see
 *     assertDeviceIpAllowed) — the first request pins it.
 * `clientIp` must come from helpers.getTrustedClientIp.
 * Throws ForbiddenError (403) or UnauthorizedError (401, wrong/missing
 * secret) — callers must catch and alert, not just log.
 */
const assertDeviceAuthorized = async (deviceSerial, providedSecret, clientIp) => {
  if (!isValidDeviceSerial(deviceSerial)) {
    throw new ForbiddenError('Device serial (SN) is missing or malformed');
  }

  const device = await loadDevice(deviceSerial);
  if (!device || !device.company_id) {
    throw new ForbiddenError('Device is not registered to a company');
  }

  if (device.device_secret && !deviceSecretMatches(device.device_secret, providedSecret)) {
    throw new UnauthorizedError('Invalid or missing device secret');
  }

  await assertDeviceIpAllowed(device, clientIp);
  return device.company_id;
};

// ── Admin actions on a device's pinned IP (Settings → Attendance → Biometric Devices) ──

/** A device this company owns, with its IP columns. */
const getCompanyDevice = async (deviceSerial, companyId) => {
  if (!companyId) throw new ForbiddenError('Company required');
  const { data, error } = await supabaseAdmin
    .from('device_heartbeats')
    .select(DEVICE_COLUMNS)
    .eq('device_serial', String(deviceSerial || ''))
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) {
    if (isMissingPinColumn(error.message)) {
      throw new BadRequestError('Device IP pinning isn\'t set up on the server yet. Ask your SpaxSync administrator to apply the latest database update.');
    }
    throw new BadRequestError(error.message);
  }
  if (!data) throw new NotFoundError('Device not found — register it under Settings > Attendance first');
  return data;
};

/**
 * "Allow new IP": the device's pending IP becomes its allowed IP.
 * `expectedIp` is the pending IP the admin was shown; if it changed since
 * (another request arrived from somewhere else), nothing is allowed, so an
 * admin can never approve an IP they didn't see.
 */
const allowPendingDeviceIp = async (deviceSerial, companyId, expectedIp, { decidedBy = null } = {}) => {
  const expected = normalizeIp(expectedIp);
  if (!expected) throw new BadRequestError('Say which IP to allow');
  const device = await getCompanyDevice(deviceSerial, companyId);
  if (!device.pending_ip) throw new BadRequestError('This device has no new IP waiting for approval');
  if (normalizeIp(device.pending_ip) !== expected) {
    throw new ConflictError('The waiting IP has changed since the page loaded. Refresh and check it again.');
  }

  const { data, error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ allowed_ip: device.pending_ip, ip_pinned_at: new Date().toISOString(), pending_ip: null, pending_ip_seen_at: null })
    .eq('device_serial', device.device_serial)
    .eq('company_id', companyId)
    .eq('pending_ip', device.pending_ip)
    .select('device_serial, allowed_ip');
  if (error) throw new BadRequestError(error.message);
  if (!data || !data.length) {
    throw new ConflictError('The waiting IP has changed since the page loaded. Refresh and check it again.');
  }
  newIpAlertSentAt.delete(device.device_serial);
  logger.info(`[ADMS] Device ${device.device_serial} now allowed from ${device.pending_ip} (was ${device.allowed_ip || 'none'})`, {
    deviceSerial: device.device_serial, companyId,
  });
  // Its request is approved, and the punches kept from this IP now count.
  const { kept, since } = await require('./admsIpApproval.service')
    .afterAllowed({ ...device, allowed_ip: device.pending_ip }, normalizeIp(device.pending_ip), { via: 'website', decidedBy })
    .catch((e) => {
      logger.error('[ADMS] Could not save the punches kept from a newly allowed IP', { deviceSerial: device.device_serial, error: e.message });
      return { kept: 0, since: null };
    });
  return {
    deviceSerial: device.device_serial, previousIp: device.allowed_ip || null, allowedIp: device.pending_ip, keptPunches: kept, keptSince: since,
  };
};

/**
 * Allows a device from `ip` because someone approved its new-IP request
 * (admsIpApproval.service.js, e.g. on WhatsApp). The IP it was allowed from
 * must still be the one the request saw (`previousIp`), so an old message
 * can't undo a newer change. Already allowed from `ip`: nothing changes.
 */
const allowDeviceFromIp = async (device, ip, previousIp) => {
  if (device.allowed_ip && ipInCidr(ip, device.allowed_ip)) return { changed: false };
  if (String(device.allowed_ip || '') !== String(previousIp || '')) {
    throw new ConflictError('this machine was allowed from a different IP since this message. Please check it in SpaxSync');
  }
  const patch = { allowed_ip: ip, ip_pinned_at: new Date().toISOString() };
  if (normalizeIp(device.pending_ip) === ip) Object.assign(patch, { pending_ip: null, pending_ip_seen_at: null });
  let query = supabaseAdmin
    .from('device_heartbeats')
    .update(patch)
    .eq('device_serial', device.device_serial)
    .eq('company_id', device.company_id);
  query = device.allowed_ip ? query.eq('allowed_ip', device.allowed_ip) : query.is('allowed_ip', null);
  const { data, error } = await query.select('device_serial');
  if (error) throw new BadRequestError(error.message);
  if (!data || !data.length) {
    throw new ConflictError('this machine was allowed from a different IP since this message. Please check it in SpaxSync');
  }
  newIpAlertSentAt.delete(device.device_serial);
  logger.info(`[ADMS] Device ${device.device_serial} now allowed from ${ip} (was ${device.allowed_ip || 'none'})`, {
    deviceSerial: device.device_serial, companyId: device.company_id,
  });
  return { changed: true };
};

/** A rejected new IP stops showing as waiting. Its punches stay kept, not counted. */
const clearPendingIp = async (device, ip) => {
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ pending_ip: null, pending_ip_seen_at: null })
    .eq('device_serial', device.device_serial)
    .eq('company_id', device.company_id)
    .eq('pending_ip', ip);
  if (error) throw new BadRequestError(error.message);
};

/**
 * "Reject" on the website: the device's waiting IP is not allowed. Like
 * Allow new IP, `expectedIp` is the IP the admin was shown.
 */
const rejectPendingDeviceIp = async (deviceSerial, companyId, expectedIp, { decidedBy = null } = {}) => {
  const expected = normalizeIp(expectedIp);
  if (!expected) throw new BadRequestError('Say which IP to reject');
  const device = await getCompanyDevice(deviceSerial, companyId);
  if (!device.pending_ip) throw new BadRequestError('This device has no new IP waiting for approval');
  if (normalizeIp(device.pending_ip) !== expected) {
    throw new ConflictError('The waiting IP has changed since the page loaded. Refresh and check it again.');
  }
  const ipApproval = require('./admsIpApproval.service');
  const opened = await ipApproval.openRequest(device, expected);
  if (opened) {
    await ipApproval.decide(opened.request.id, 'reject', { companyId, decidedBy, via: 'website' });
  } else {
    await clearPendingIp(device, expected);
  }
  logger.info(`[ADMS] New IP ${expected} for device ${device.device_serial} rejected on the website`, { deviceSerial: device.device_serial, companyId });
  return { deviceSerial: device.device_serial, rejectedIp: expected, allowedIp: device.allowed_ip || null };
};

/**
 * A registered device's push from an IP it isn't allowed: its ATTLOG punches
 * are kept (admsIpApproval.service.js) and count once someone approves the
 * IP. True when that worked — the device is then told OK; false when it
 * couldn't (before the migration, or the database failed) — told NOK, as before.
 */
const keepPushFromNewIp = async (device, clientIp, table, body) => {
  const ip = normalizeIp(clientIp);
  if (!device?.company_id || !device.device_serial || !ip) return false;
  const ipApproval = require('./admsIpApproval.service');
  // Anything but punches is ignored, as it is from the allowed IP.
  if (table !== 'ATTLOG') return ipApproval.keepingAvailable();
  const punches = dropFuturePunches(parseAttlogBody(body, device.device_serial), device.device_serial);
  return ipApproval.keepPunches(device, ip, punches);
};

/** "Re-learn IP": forget the pinned IP; the device's next request pins a new one. */
const relearnDeviceIp = async (deviceSerial, companyId) => {
  const device = await getCompanyDevice(deviceSerial, companyId);
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ allowed_ip: null, ip_pinned_at: null, pending_ip: null, pending_ip_seen_at: null })
    .eq('device_serial', device.device_serial)
    .eq('company_id', companyId);
  if (error) throw new BadRequestError(error.message);
  newIpAlertSentAt.delete(device.device_serial);
  logger.info(`[ADMS] Device ${device.device_serial} IP cleared; its next request pins a new one`, {
    deviceSerial: device.device_serial, companyId, previousIp: device.allowed_ip || null,
  });
  return { deviceSerial: device.device_serial, previousIp: device.allowed_ip || null };
};

/** Clears the IP columns when a device changes hands (release / a fresh claim). Before the migration it does nothing. */
const clearDeviceIpPin = async (deviceSerial) => {
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ allowed_ip: null, ip_pinned_at: null, pending_ip: null, pending_ip_seen_at: null })
    .eq('device_serial', deviceSerial);
  if (error && !isMissingPinColumn(error.message)) {
    logger.error('[ADMS] Could not clear the device IP', { deviceSerial, error: error.message });
  }
};

/** "2026-08-21 09:15:00" (device-local IST, naive) -> ISO instant. */
const parseDeviceTimestamp = (raw) => {
  const parsed = moment.tz(String(raw || '').trim(), 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
  return parsed.isValid() ? parsed.toISOString() : null;
};

/**
 * One ATTLOG line: USER_ID\tTIMESTAMP\tSTATUS\tVERIFY\t...(ignored trailing fields).
 * Returns null for lines that can't be parsed at all (blank lines, short lines).
 */
const parseAttlogLine = (line, deviceSerial) => {
  const fields = line.split('\t');
  if (fields.length < 2) return null;

  const [deviceUserId, timestampRaw, statusRaw, verifyRaw] = fields;
  if (!deviceUserId || !timestampRaw) return null;

  const punchTime = parseDeviceTimestamp(timestampRaw);
  if (!punchTime) return null;

  const statusCode = Number(statusRaw);
  const verifyCode = Number(verifyRaw);

  return {
    device_user_id: String(deviceUserId).trim(),
    punch_time: punchTime,
    punch_type: STATUS_TO_PUNCH_TYPE[statusCode] || 'unknown',
    verify_mode: VERIFY_TO_MODE[verifyCode] || null,
    device_serial: deviceSerial || null,
    raw_data: line,
  };
};

/** A real device batches at most a few hundred punches per push; cap well above that. */
const MAX_ATTLOG_LINES_PER_REQUEST = 2000;

/** Parse a full ADMS cdata body (one or more \n-separated ATTLOG lines). */
const parseAttlogBody = (body, deviceSerial) =>
  String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_ATTLOG_LINES_PER_REQUEST)
    .map((line) => parseAttlogLine(line, deviceSerial))
    .filter(Boolean);

/**
 * Look up employee_id + company_id for each distinct device_user_id via
 * device_employee_mapping (scoped to this device's serial), in one query.
 * `registeredCompanyId` is the company this serial is actually claimed to
 * (from assertDeviceAuthorized) — any resolved mapping pointing to a
 * DIFFERENT company is a data-integrity or spoofing anomaly (device mapping
 * creation is itself company-scoped, so this should never happen through
 * normal use) and is dropped rather than written, with a security alert.
 */
const mapPunchesToEmployees = async (punches, deviceSerial, registeredCompanyId) => {
  const deviceUserIds = [...new Set(punches.map((p) => p.device_user_id))];
  if (!deviceUserIds.length) return punches;

  const { data: mappings, error } = await supabaseAdmin
    .from('device_employee_mapping')
    .select('device_user_id, employee_id, employees(company_id)')
    .eq('device_serial', deviceSerial)
    .in('device_user_id', deviceUserIds);

  if (error) {
    logger.error('[ADMS] Mapping lookup failed', { error: error.message });
    return punches;
  }

  const byDeviceUserId = new Map((mappings || []).map((m) => [m.device_user_id, m]));
  const result = [];
  let crossCompanyDropped = 0;

  for (const p of punches) {
    const mapping = byDeviceUserId.get(p.device_user_id);
    if (!mapping) {
      logger.warn(`[ADMS] punch unmapped: device_user_${p.device_user_id} (no mapping found)`);
      result.push({ ...p, employee_id: null, company_id: null });
      continue;
    }

    const mappedCompanyId = mapping.employees?.company_id || null;
    if (registeredCompanyId && mappedCompanyId && mappedCompanyId !== registeredCompanyId) {
      crossCompanyDropped += 1;
      logger.error('[ADMS] Dropped punch: mapped employee belongs to a different company than the registered device', {
        deviceSerial, deviceUserId: p.device_user_id, employeeId: mapping.employee_id,
        mappedCompanyId, registeredCompanyId,
      });
      continue;
    }

    logger.info(`[ADMS] punch mapped: device_user_${p.device_user_id} -> employee ${mapping.employee_id}`);
    result.push({ ...p, employee_id: mapping.employee_id, company_id: mappedCompanyId });
  }

  if (crossCompanyDropped > 0) {
    await alertOnUnauthorizedDevice(
      deviceSerial,
      `${crossCompanyDropped} punch(es) mapped to an employee outside the device's registered company were dropped.`,
    ).catch((e) => logger.error('[ADMS] alertOnUnauthorizedDevice failed', { error: e.message }));
  }

  return result;
};

/**
 * Same rate-limited email-alert pattern as alertOnSaveFailure below, but for
 * a rejected/anomalous device request (unclaimed serial, wrong device
 * secret, or a cross-company mapping) instead of a DB save failure — this is
 * the only signal anyone gets that someone is probing or misusing the
 * unauthenticated ADMS endpoints, since the device/attacker always still
 * sees a plain rejection with no further detail.
 */
const UNAUTHORIZED_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const UNAUTHORIZED_ALERT_SETTING_KEY = 'adms_unauthorized_last_alert_at';

/** A serial for an email subject: only a well-formed one, never raw attacker text. */
const serialForSubject = (deviceSerial) => (isValidDeviceSerial(deviceSerial) ? deviceSerial : 'unknown device');

/** Every value here can come from an unauthenticated request, so all of it is escaped. */
const unauthorizedDeviceAlertEmail = (deviceSerial, reason, meta = {}) => ({
  subject: `[ADMS ALERT] Rejected/anomalous device request (${serialForSubject(deviceSerial)})`,
  html: `<p>A request to the biometric device endpoints was rejected or produced an anomaly.</p>
<p>Device: <strong>${escapeHtml(deviceSerial || 'unknown')}</strong></p>
<p>Reason: <code>${escapeHtml(reason)}</code></p>
${meta.ip ? `<p>Source IP: <code>${escapeHtml(meta.ip)}</code></p>` : ''}
<p>This may be a misconfigured device or an attempt to push forged attendance data through <code>/iclock/cdata</code>.</p>
<p>(This alert is rate-limited to once every 15 minutes while it continues.)</p>`,
});

const alertOnUnauthorizedDevice = async (deviceSerial, reason, meta = {}) => {
  const settingsService = require('./settings.service');
  const now = Date.now();
  const lastAlertIso = await settingsService.getSetting(UNAUTHORIZED_ALERT_SETTING_KEY, null, null);
  const lastAlertAt = lastAlertIso ? new Date(lastAlertIso).getTime() : 0;
  if (now - lastAlertAt < UNAUTHORIZED_ALERT_COOLDOWN_MS) return;
  await settingsService.setSetting(UNAUTHORIZED_ALERT_SETTING_KEY, new Date(now).toISOString(), null, null);

  const to = await require('./emailRecipients.service').getPlatformAlertTo(['full_admin', 'support_admin']).catch(() => '');
  if (!to) return;

  const { sendEmail } = require('./email.service');
  sendEmail({
    type: 'adms_unauthorized_alert',
    to,
    ...unauthorizedDeviceAlertEmail(deviceSerial, reason, meta),
  }).catch((e) => logger.error('[ADMS] Failed to send unauthorized-device alert email', { error: e.message }));
};

/**
 * A genuine DB-level save failure here is silent to the device — the ADMS
 * response to the device always says "OK" regardless (deliberately, to avoid
 * a retry-storm on routine cases like an unmapped user), so nothing tells
 * anyone this class of failure is happening except server logs. Alert by
 * email the moment it starts, rate-limited so a sustained outage sends one
 * notice per window instead of one per punch.
 */
const SAVE_FAILURE_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const SAVE_FAILURE_ALERT_SETTING_KEY = 'adms_save_failure_last_alert_at';

const saveFailureAlertEmail = (deviceSerial, errorMessage) => ({
  subject: `[ADMS ALERT] Biometric punches are failing to save (${serialForSubject(deviceSerial)})`,
  html: `<p>Device <strong>${escapeHtml(deviceSerial || 'unknown')}</strong> is pushing punches successfully, but they are failing to save to the database.</p>
<p>Error: <code>${escapeHtml(errorMessage)}</code></p>
<p>Punches are being lost silently until this is fixed — check the ADMS logs and the <code>device_punches</code> table/constraints immediately.</p>
<p>(This alert is rate-limited to once every 15 minutes while the failure continues.)</p>`,
});

const alertOnSaveFailure = async (deviceSerial, errorMessage, count) => {
  // Backed by system_settings (not an in-memory variable) so the cooldown is
  // shared across every server instance/worker, not reset per-process.
  const settingsService = require('./settings.service');
  const now = Date.now();
  const lastAlertIso = await settingsService.getSetting(SAVE_FAILURE_ALERT_SETTING_KEY, null, null);
  const lastAlertAt = lastAlertIso ? new Date(lastAlertIso).getTime() : 0;
  if (now - lastAlertAt < SAVE_FAILURE_ALERT_COOLDOWN_MS) return;
  await settingsService.setSetting(SAVE_FAILURE_ALERT_SETTING_KEY, new Date(now).toISOString(), null, null);

  const to = await require('./emailRecipients.service').getPlatformAlertTo(['full_admin', 'support_admin']).catch(() => '');
  if (!to) return;

  const { sendEmail } = require('./email.service');
  sendEmail({
    type: 'adms_save_failure_alert',
    to,
    ...saveFailureAlertEmail(deviceSerial, errorMessage),
  }).catch((e) => logger.error('[ADMS] Failed to send save-failure alert email', { error: e.message }));
};

/**
 * Section G2: data_collection_mode='stop' for biometric_adms — punches are
 * still ACKNOWLEDGED to the device (the caller always gets "OK" regardless,
 * per the existing comment above on alertOnSaveFailure — nothing here
 * changes that), but never reach `attendance` or even `device_punches`.
 * Written instead to adms_discarded_punches (purged after 7 days — a
 * reversibility window, not silent permanent loss). Deliberately the ONLY
 * change to this file's write path — assertDeviceAuthorized, parsing, and
 * the C-01 device-isolation logic above are all untouched.
 */
const discardPunchesForStoppedCollection = async (punches, deviceSerial, companyId) => {
  const rows = punches.map((p) => ({ company_id: companyId, device_serial: deviceSerial, raw_punch_data: p }));
  const { error } = await supabaseAdmin.from('adms_discarded_punches').insert(rows);
  if (error) logger.error('[ADMS] Failed to write discarded punches', { error: error.message, count: rows.length });
  logger.info('[ADMS] Punches discarded — data_collection_mode is stop', { companyId, deviceSerial, count: punches.length });

  // Opportunistic purge (>7 days old) on the way in — piggybacks on real
  // traffic rather than needing a dedicated cron registration for what's a
  // low-volume, best-effort housekeeping table.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  supabaseAdmin.from('adms_discarded_punches').delete().lt('discarded_at', cutoff)
    .then(({ error: purgeError }) => {
      if (purgeError) logger.warn('[ADMS] Discarded-punch purge failed', { error: purgeError.message });
    });
};

/**
 * A punch more than 10 minutes ahead of the server clock is refused and
 * logged: nobody has punched in the future, and a forged one would pre-fill
 * a day. Old punches are kept — devices upload their backlog after being
 * offline.
 */
const MAX_PUNCH_FUTURE_SKEW_MS = 10 * 60 * 1000;

const dropFuturePunches = (punches, deviceSerial, now = Date.now()) => {
  const limit = now + MAX_PUNCH_FUTURE_SKEW_MS;
  const kept = [];
  const refused = [];
  for (const p of punches) (new Date(p.punch_time).getTime() > limit ? refused : kept).push(p);
  if (refused.length) {
    logger.warn(`[ADMS] Refused ${refused.length} punch(es) from device ${deviceSerial} timestamped more than 10 minutes in the future. Check the device clock.`, {
      deviceSerial,
      serverTime: new Date(now).toISOString(),
      punches: refused.slice(0, 10).map((p) => ({ deviceUserId: p.device_user_id, punchTime: p.punch_time })),
    });
  }
  return kept;
};

/** Insert punches, silently skipping ones already seen (same device_user_id + punch_time). */
const savePunches = async (allPunches, deviceSerial, registeredCompanyId) => {
  const punches = dropFuturePunches(allPunches, deviceSerial);
  if (!punches.length) return { inserted: 0 };

  if (registeredCompanyId) {
    const featureOverrideService = require('./featureOverride.service');
    const mode = await featureOverrideService.getDataCollectionMode(registeredCompanyId, 'biometric_adms');
    if (mode === 'stop') {
      await discardPunchesForStoppedCollection(punches, deviceSerial, registeredCompanyId);
      return { inserted: 0, discarded: punches.length };
    }
  }

  const enriched = await mapPunchesToEmployees(punches, deviceSerial, registeredCompanyId);
  const { error } = await supabaseAdmin
    .from('device_punches')
    .upsert(enriched, { onConflict: 'device_serial,device_user_id,punch_time', ignoreDuplicates: true });

  if (error) {
    logger.error('[ADMS] Failed to save punches', { error: error.message, count: enriched.length });
    await alertOnSaveFailure(deviceSerial, error.message, enriched.length).catch((e) => {
      logger.error('[ADMS] alertOnSaveFailure itself failed', { error: e.message });
    });
    return { inserted: 0, error };
  }

  await syncAffectedAttendanceDays(enriched);

  return { inserted: enriched.length };
};

/**
 * Turn today's (and any backlogged) mapped punches into real attendance records —
 * first/last punch per shift-day window, anchored to each employee's own assigned
 * shift start (not midnight), so overnight shifts bucket into the right day.
 */
const syncAffectedAttendanceDays = async (punches) => {
  const attendanceService = require('./attendance.service');

  const punchesByEmployee = new Map();
  for (const p of punches) {
    if (!p.employee_id) continue;
    if (!punchesByEmployee.has(p.employee_id)) punchesByEmployee.set(p.employee_id, []);
    punchesByEmployee.get(p.employee_id).push(p);
  }

  await Promise.all(
    [...punchesByEmployee.entries()].map(async ([employeeId, empPunches]) => {
      const shiftStart = await attendanceService.getEmployeeShiftStart(employeeId).catch(() => '09:30');
      const windowStartIsos = new Set(
        empPunches.map((p) => getShiftDayWindow(moment.tz(p.punch_time, TIMEZONE), shiftStart).windowStart.toISOString())
      );

      await Promise.all(
        [...windowStartIsos].map((windowStartIso) =>
          attendanceService.recomputeBiometricWindow(employeeId, windowStartIso).catch((err) => {
            logger.error('[ADMS] Attendance sync failed', { employeeId, windowStartIso, error: err.message });
          })
        )
      );
    })
  );
};

const todayRangeIso = () => {
  const start = moment.tz(TIMEZONE).startOf('day').toISOString();
  const end = moment.tz(TIMEZONE).endOf('day').toISOString();
  return { start, end };
};

module.exports = {
  touchHeartbeat,
  parseAttlogBody,
  savePunches,
  dropFuturePunches,
  todayRangeIso,
  isValidDeviceSerial,
  assertDeviceAuthorized,
  alertOnUnauthorizedDevice,
  unauthorizedDeviceAlertEmail,
  saveFailureAlertEmail,
  deviceNewIpEmail,
  getCompanyDevice,
  allowPendingDeviceIp,
  allowDeviceFromIp,
  clearPendingIp,
  rejectPendingDeviceIp,
  keepPushFromNewIp,
  relearnDeviceIp,
  clearDeviceIpPin,
  isMissingPinColumn,
};
