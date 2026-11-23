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

const DEVICE_COLUMNS = 'device_serial, company_id, name, location, device_secret, allowed_ip, pending_ip, pending_ip_seen_at, ip_pinned_at, last_seen_at';
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
 * Before the kept-punches migration runs, "new IP" emails go at most once per
 * device per hour, even if someone keeps sending from different IPs. After
 * it, each new IP opens one request and is announced once
 * (admsIpApproval.service.js), at most 5 waiting per machine.
 */
const NEW_IP_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const newIpAlertSentAt = new Map();

/**
 * Subject and HTML for the "device reporting from a new IP" email. Every
 * device-supplied value is escaped. `kept`: its punches from the new IP are
 * kept until someone decides (admsIpApproval.service.js), not refused; `text`
 * (describeRequest) adds the areas, the punches so far, and a warning when the
 * device was still online on its old IP just before.
 */
const deviceNewIpEmail = ({ deviceSerial, name, location, allowedIp, newIp, kept = false, text = null }) => {
  const label = name ? `${name} (${deviceSerial})` : deviceSerial;
  const details = text
    ? `<p>New IP: <code>${escapeHtml(text.newIp)}</code><br>Allowed IP until now: <code>${escapeHtml(text.previousIp)}</code><br>Punches from the new IP so far: ${escapeHtml(text.punches)}</p>`
    : `<p>Allowed IP: <code>${escapeHtml(allowedIp || 'none')}</code><br>New IP: <code>${escapeHtml(newIp)}</code></p>`;
  const warning = text?.stillOnline
    ? `<p><strong>Careful:</strong> the device was still online on its allowed IP at ${escapeHtml(text.lastSeen)}, just before this. An office internet change rarely looks like that; someone may be using this device's serial number.</p>`
    : '';
  const whatHappens = kept
    ? `<p>These punches are kept, not counted. <strong>Approve</strong>: they count, at the times they were made. <strong>Reject</strong>: they are deleted.</p>
<p>Approve only if your office's internet connection changed (new provider, router restart with a new public IP): tap <strong>Approve</strong> on the WhatsApp message, or open <strong>Settings → Attendance → Biometric Devices</strong>.</p>`
    : `<p>Punches from the new IP are being refused until it is allowed. Most devices keep them and send them again, but not every device does, so please act soon.</p>
<p>If your office's internet connection changed (new provider, router restart with a new public IP), open <strong>Settings → Attendance → Biometric Devices</strong> and choose <strong>Allow new IP</strong> for this device.</p>`;
  return {
    subject: `Biometric device ${String(name || deviceSerial).slice(0, 60)} is reporting from a new IP`,
    html: `<p>Your biometric device <strong>${escapeHtml(label)}</strong>${location ? ` at ${escapeHtml(location)}` : ''} sent a request from an IP address it is not allowed to use.</p>
${details}
${warning}
${whatHappens}
<p>If nothing changed at your office, do not allow it${kept ? ' (on WhatsApp, tap Reject)' : ''}: someone may be using this device's serial number to send fake attendance. Contact SpaxSync support.</p>`,
  };
};

/**
 * Emails the people chosen to approve a new IP (Settings → Attendance →
 * Biometric Devices; every HR and Admin by default). Nobody chosen has an
 * email: the admins, then HR.
 */
const emailNewIp = async (device, newIp, { kept = false, text = null, approvers = null } = {}) => {
  const people = approvers || await require('./admsIpApproval.service').approverEmployees(device.company_id).catch(() => []);
  const recipientsService = require('./emailRecipients.service');
  let recipients = people.filter((a) => a.email);
  if (!recipients.length) recipients = await recipientsService.getAdminEmailRecipients(device.company_id).catch(() => []);
  if (!recipients.length) recipients = await recipientsService.getHrEmailRecipients(device.company_id).catch(() => []);
  if (!recipients.length) {
    logger.warn('[ADMS] No admin to tell about a device reporting from a new IP', { deviceSerial: device.device_serial, companyId: device.company_id });
  }
  const { sendEmail } = require('./email.service');
  const { subject, html } = deviceNewIpEmail({
    deviceSerial: device.device_serial, name: device.name, location: device.location, allowedIp: device.allowed_ip, newIp, kept, text,
  });
  for (const r of recipients) {
    Promise.resolve()
      .then(() => sendEmail({ type: 'adms_device_new_ip', to: r.email, subject, html }))
      .catch((e) => logger.error('[ADMS] Failed to send new-IP email', { deviceSerial: device.device_serial, error: e.message }));
  }
};

/** Before the kept-punches migration: the "refused until allowed" email, once per device per hour. */
const alertAdminsOfNewDeviceIp = async (device, newIp) => {
  const last = newIpAlertSentAt.get(device.device_serial) || 0;
  if (Date.now() - last < NEW_IP_ALERT_COOLDOWN_MS) return;
  newIpAlertSentAt.set(device.device_serial, Date.now());
  await emailNewIp(device, newIp, { kept: false });
};

/**
 * Writes pending_ip, the latest IP a device called from that isn't allowed
 * (only when it changed, so a retrying device writes once). True when it changed.
 */
const markPendingIp = async (device, ip) => {
  if (normalizeIp(device.pending_ip) === ip) return false;
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ pending_ip: ip, pending_ip_seen_at: new Date().toISOString() })
    .eq('device_serial', device.device_serial)
    .eq('company_id', device.company_id);
  if (error) {
    logger.error('[ADMS] Could not record a device\'s new IP', { deviceSerial: device.device_serial, error: error.message });
    return false;
  }
  logger.warn(`[ADMS] Device ${device.device_serial} (company ${device.company_id}) is pinned to ${device.allowed_ip} but called from ${ip}; it waits for someone to approve or reject it.`, {
    deviceSerial: device.device_serial, companyId: device.company_id, allowedIp: device.allowed_ip, newIp: ip,
  });
  return true;
};

/**
 * A registered device called from an IP it isn't allowed (any /iclock
 * request). After the kept-punches migration: that IP's request is opened (or
 * found), an ATTLOG push's punches are kept under it, and a new request is
 * announced once the punches are in, so the message can say what arrived.
 * Before it: the "refused" email. True when the device may be told OK; false
 * for NOK (before the migration, too many IPs waiting, or nothing could be
 * kept).
 */
const handleNewIpContact = async (device, clientIp, { table = null, body = null } = {}) => {
  const ip = normalizeIp(clientIp);
  if (!device?.company_id || !device.device_serial || !ip) return false;
  const ipApproval = require('./admsIpApproval.service');
  if (!(await ipApproval.keepingAvailable())) {
    // As before the migration: told once per new IP (and at most hourly per device).
    if (device.pending_ip_changed) {
      await alertAdminsOfNewDeviceIp(device, ip).catch((e) => logger.error('[ADMS] New-IP alert failed', { error: e.message }));
    }
    return false;
  }
  const opened = await ipApproval.openRequest(device, ip);
  if (!opened) return false;
  let ok = true;
  // Anything but punches is ignored, as it is from the allowed IP.
  if (table === 'ATTLOG') {
    const punches = dropFuturePunches(parseAttlogBody(body, device.device_serial), device.device_serial);
    ok = await ipApproval.keepPunches(device, ip, punches, opened.request);
  }
  if (opened.created) {
    await ipApproval.notifyNewRequest(device, opened.request)
      .catch((e) => logger.error('[ADMS] Could not announce a new device IP', { deviceSerial: device.device_serial, error: e.message }));
  }
  return ok;
};

/**
 * Source-IP pinning — the eSSL push protocol can't carry a login or custom
 * header, so the device's public IP is the one thing a person who only knows
 * the serial can't fake. A registered device with no allowed_ip yet pins
 * the IP of its first request; after that, a request from any other IP is
 * not accepted as the device: it waits for someone to approve or reject that
 * IP (handleNewIpContact).
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
      return;
    }
    // Another request pinned it between our read and our write — check against that.
    current = await loadDevice(current.device_serial);
    if (!current?.company_id || current.company_id !== device.company_id || !current.allowed_ip) {
      throw new ForbiddenError('Device is not registered to a company');
    }
  }

  if (ipInCidr(ip, current.allowed_ip)) return;

  const pendingIpChanged = await markPendingIp(current, ip);
  const err = new ForbiddenError('Device is calling from an IP that is not allowed for it');
  err.deviceIpMismatch = true;
  // What handleNewIpContact needs (never the device secret).
  err.device = {
    device_serial: current.device_serial,
    company_id: current.company_id,
    name: current.name,
    location: current.location,
    allowed_ip: current.allowed_ip,
    last_seen_at: current.last_seen_at || null,
    pending_ip_changed: pendingIpChanged,
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

/** A database failure: logged in full, reported to the caller as a plain 500 so nothing internal shows. */
const dbFailure = (what, error, deviceSerial) => {
  logger.error(`[ADMS] ${what}`, { deviceSerial, error: error?.message });
  return new Error(`${what}. Nothing was changed; please try again.`);
};

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
    throw dbFailure('Could not load the device', error, deviceSerial);
  }
  if (!data) throw new NotFoundError('Device not found — register it under Settings > Attendance first');
  return data;
};

/**
 * "Allow new IP" on the website. `expectedIp` is the waiting IP the admin was
 * shown, so an admin can never approve an IP they didn't see. After the
 * kept-punches migration it approves that IP's request (its kept punches then
 * count); before it, the device's pending IP becomes its allowed IP.
 */
const allowPendingDeviceIp = async (deviceSerial, companyId, expectedIp, { decidedBy = null } = {}) => {
  const expected = normalizeIp(expectedIp);
  if (!expected) throw new BadRequestError('Say which IP to allow');
  const device = await getCompanyDevice(deviceSerial, companyId);
  const ipApproval = require('./admsIpApproval.service');
  if (await ipApproval.keepingAvailable()) {
    const request = await ipApproval.pendingRequestFor(device, expected);
    if (!request) throw new ConflictError('That IP is no longer waiting for this device. Refresh and check again.');
    const result = await ipApproval.decide(request.id, 'approve', { companyId, decidedBy, via: 'website' });
    return {
      deviceSerial: device.device_serial,
      previousIp: device.allowed_ip || null,
      allowedIp: expected,
      keptPunches: result.kept,
      keptPeople: result.people,
      keptSince: result.since,
    };
  }
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
  if (error) throw dbFailure('Could not allow the new IP', error, device.device_serial);
  if (!data || !data.length) {
    throw new ConflictError('The waiting IP has changed since the page loaded. Refresh and check it again.');
  }
  newIpAlertSentAt.delete(device.device_serial);
  logger.info(`[ADMS] Device ${device.device_serial} now allowed from ${device.pending_ip} (was ${device.allowed_ip || 'none'})`, {
    deviceSerial: device.device_serial, companyId,
  });
  return {
    deviceSerial: device.device_serial, previousIp: device.allowed_ip || null, allowedIp: device.pending_ip, keptPunches: 0, keptPeople: 0, keptSince: null,
  };
};

/**
 * Allows a device from `ip` because someone approved its new-IP request
 * (admsIpApproval.service.js). With `checkPrevious` (WhatsApp) the IP it was
 * allowed from must still be the one the message showed (`previousIp`), so an
 * old message can't undo a newer change; the website decides on what the page
 * shows now. Either way the write only lands if nothing changed since `device`
 * was read. Already allowed from `ip`: nothing changes.
 */
const allowDeviceFromIp = async (device, ip, previousIp, { checkPrevious = true } = {}) => {
  if (device.allowed_ip && ipInCidr(ip, device.allowed_ip)) return { changed: false };
  if (checkPrevious && String(device.allowed_ip || '') !== String(previousIp || '')) {
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
  if (error) throw dbFailure('Could not allow the new IP', error, device.device_serial);
  if (!data || !data.length) {
    throw new ConflictError('this machine was allowed from a different IP since this message. Please check it in SpaxSync');
  }
  newIpAlertSentAt.delete(device.device_serial);
  logger.info(`[ADMS] Device ${device.device_serial} now allowed from ${ip} (was ${device.allowed_ip || 'none'})`, {
    deviceSerial: device.device_serial, companyId: device.company_id,
  });
  return { changed: true };
};

/** A rejected new IP stops showing as the device's latest waiting IP. */
const clearPendingIp = async (device, ip) => {
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ pending_ip: null, pending_ip_seen_at: null })
    .eq('device_serial', device.device_serial)
    .eq('company_id', device.company_id)
    .eq('pending_ip', ip);
  if (error) {
    logger.error('[ADMS] Could not clear a device\'s waiting IP', { deviceSerial: device.device_serial, error: error.message });
    throw new Error('Could not update the device. Nothing was changed; please try again.');
  }
};

/**
 * "Reject" on the website: the waiting IP is not allowed and the punches kept
 * from it are deleted. Like Allow new IP, `expectedIp` is the IP the admin
 * was shown. Before the kept-punches migration it just stops showing.
 */
const rejectPendingDeviceIp = async (deviceSerial, companyId, expectedIp, { decidedBy = null } = {}) => {
  const expected = normalizeIp(expectedIp);
  if (!expected) throw new BadRequestError('Say which IP to reject');
  const device = await getCompanyDevice(deviceSerial, companyId);
  const ipApproval = require('./admsIpApproval.service');
  let deleted = 0;
  if (await ipApproval.keepingAvailable()) {
    const request = await ipApproval.pendingRequestFor(device, expected);
    if (!request) throw new ConflictError('That IP is no longer waiting for this device. Refresh and check again.');
    ({ kept: deleted } = await ipApproval.decide(request.id, 'reject', { companyId, decidedBy, via: 'website' }));
  } else {
    if (!device.pending_ip) throw new BadRequestError('This device has no new IP waiting for approval');
    if (normalizeIp(device.pending_ip) !== expected) {
      throw new ConflictError('The waiting IP has changed since the page loaded. Refresh and check it again.');
    }
    await clearPendingIp(device, expected);
  }
  logger.info(`[ADMS] New IP ${expected} for device ${device.device_serial} rejected on the website`, { deviceSerial: device.device_serial, companyId });
  return {
    deviceSerial: device.device_serial, rejectedIp: expected, allowedIp: device.allowed_ip || null, deletedPunches: deleted,
  };
};

/**
 * Clears the IP columns when a device changes hands (release / a fresh
 * claim), with its waiting IPs and kept punches. Before the migrations it
 * does nothing.
 */
const clearDeviceIpPin = async (deviceSerial) => {
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .update({ allowed_ip: null, ip_pinned_at: null, pending_ip: null, pending_ip_seen_at: null })
    .eq('device_serial', deviceSerial);
  if (error && !isMissingPinColumn(error.message)) {
    logger.error('[ADMS] Could not clear the device IP', { deviceSerial, error: error.message });
  }
  newIpAlertSentAt.delete(deviceSerial);
  await require('./admsIpApproval.service').purgeForSerial(deviceSerial);
};

/** "2026-08-21 09:15:00" (device-local IST, naive) -> ISO instant. */
const parseDeviceTimestamp = (raw) => {
  const parsed = moment.tz(String(raw || '').trim(), 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
  return parsed.isValid() ? parsed.toISOString() : null;
};

/**
 * A device's user ID is a short PIN (digits, sometimes letters); the raw line
 * is kept only for reference. Anything longer is not a real device's.
 */
const MAX_DEVICE_USER_ID_LENGTH = 32;
const MAX_LINE_LENGTH = 512;
const MAX_RAW_DATA_LENGTH = 255;

/**
 * One ATTLOG line: USER_ID\tTIMESTAMP\tSTATUS\tVERIFY\t...(ignored trailing fields).
 * Returns null for lines that can't be parsed (blank, short, or longer than a
 * real device sends).
 */
const parseAttlogLine = (line, deviceSerial) => {
  if (line.length > MAX_LINE_LENGTH) return null;
  const fields = line.split('\t');
  if (fields.length < 2) return null;

  const [deviceUserIdRaw, timestampRaw, statusRaw, verifyRaw] = fields;
  const deviceUserId = String(deviceUserIdRaw || '').trim();
  if (!deviceUserId || deviceUserId.length > MAX_DEVICE_USER_ID_LENGTH || !timestampRaw) return null;

  const punchTime = parseDeviceTimestamp(timestampRaw);
  if (!punchTime) return null;

  const statusCode = Number(statusRaw);
  const verifyCode = Number(verifyRaw);

  return {
    device_user_id: deviceUserId,
    punch_time: punchTime,
    punch_type: STATUS_TO_PUNCH_TYPE[statusCode] || 'unknown',
    verify_mode: VERIFY_TO_MODE[verifyCode] || null,
    device_serial: deviceSerial || null,
    raw_data: line.slice(0, MAX_RAW_DATA_LENGTH),
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

// ── Punches from a file downloaded from the machine (USB) ──────────────────

/**
 * For punches the server never received (e.g. refused from a new IP before
 * punches were kept, 19–20 Nov 2026): an Admin downloads the attendance log
 * from the machine to a pen drive (USB → Download → Attendance) and adds it in
 * Settings → Attendance → Biometric Devices. Only punches in the chosen dates
 * (at most 31 days, within the last 62) are added; ones already there are
 * skipped, and attendance is worked out again as for any punch.
 */
const MAX_IMPORT_LINES = 20000;
const MAX_IMPORT_DAYS = 31;
const MAX_IMPORT_AGE_DAYS = 62;
const IMPORT_BATCH = 1000;
const DATE_TIME = /(\d{4})[-/](\d{2})[-/](\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/;

/**
 * Lines of the machine's attendance file: "<user id> <date> <time> …" (the
 * attlog.dat a ZKTeco / eSSL machine writes), or a tab-separated file whose
 * header names EnNo and DateTime (eSSL's GLG export).
 */
const parseImportedLines = (lines, deviceSerial) => {
  const punches = [];
  let unreadable = 0;
  let columns = null;
  lines.forEach((value) => {
    const line = String(value ?? '').replace(/\r$/, '');
    if (!line.trim()) return;
    if (line.length > MAX_LINE_LENGTH) { unreadable += 1; return; }
    const cells = line.split('\t').map((c) => c.trim());
    if (!columns && /\benno\b/i.test(line) && /date\s*time/i.test(line)) {
      columns = {
        id: cells.findIndex((c) => /^enno$/i.test(c)),
        at: cells.findIndex((c) => /^date\s*time$/i.test(c)),
      };
      return;
    }
    let id;
    let at;
    if (columns && columns.id >= 0 && columns.at >= 0) {
      id = cells[columns.id];
      at = cells[columns.at];
    } else {
      const match = line.match(/^\s*(\S+)\s+([\s\S]*)$/);
      id = match?.[1];
      at = match?.[2];
    }
    const when = String(at || '').match(DATE_TIME);
    const punchTime = when
      ? parseDeviceTimestamp(`${when[1]}-${when[2]}-${when[3]} ${when[4].padStart(2, '0')}:${when[5]}:${when[6] || '00'}`)
      : null;
    if (!id || id.length > MAX_DEVICE_USER_ID_LENGTH || !punchTime) { unreadable += 1; return; }
    punches.push({
      device_user_id: id,
      punch_time: punchTime,
      punch_type: 'unknown',
      verify_mode: null,
      device_serial: deviceSerial,
      raw_data: line.slice(0, MAX_RAW_DATA_LENGTH),
    });
  });
  return { punches, unreadable };
};

/** "2026-11-19" → that IST day, or null. */
const istDay = (value) => {
  const day = moment.tz(String(value || ''), 'YYYY-MM-DD', true, TIMEZONE);
  return day.isValid() ? day : null;
};

/**
 * Previews (`dryRun`, the default) or adds the punches of a machine's file
 * for `from`–`to` (IST dates). Returns what was found: how many lines were
 * readable, how many punches fall in the dates, how many are already in
 * SpaxSync, how many would be added (per day), and the machine user IDs that
 * aren't linked to an employee. `saved` is how many were added.
 */
const importPunchesFromFile = async (deviceSerial, companyId, { lines, from, to, dryRun = true } = {}) => {
  const device = await getCompanyDevice(deviceSerial, companyId);
  if (!Array.isArray(lines) || !lines.length) throw new BadRequestError('The file has no punches in it');
  if (lines.length > MAX_IMPORT_LINES) throw new BadRequestError(`At most ${MAX_IMPORT_LINES} lines at a time. Choose fewer days.`);
  const start = istDay(from);
  const end = istDay(to);
  if (!start || !end) throw new BadRequestError('Choose the dates to add, from and to');
  const today = moment.tz(TIMEZONE).startOf('day');
  if (end.isBefore(start)) throw new BadRequestError('The "to" date is before the "from" date');
  if (end.isAfter(today)) throw new BadRequestError('The dates can\'t be in the future');
  if (end.diff(start, 'days') + 1 > MAX_IMPORT_DAYS) throw new BadRequestError(`At most ${MAX_IMPORT_DAYS} days at a time`);
  if (today.diff(start, 'days') > MAX_IMPORT_AGE_DAYS) throw new BadRequestError(`Only the last ${MAX_IMPORT_AGE_DAYS} days can be added from a file`);
  const startMs = start.clone().startOf('day').valueOf();
  const endMs = end.clone().endOf('day').valueOf();

  const { punches, unreadable } = parseImportedLines(lines, device.device_serial);
  const inDates = punches.filter((p) => {
    const at = new Date(p.punch_time).getTime();
    return at >= startMs && at <= endMs;
  });

  // The file may pad user IDs with zeros ("00000012") where the machine pushes "12".
  const { data: mappings, error: mappingError } = await supabaseAdmin
    .from('device_employee_mapping')
    .select('device_user_id')
    .eq('device_serial', device.device_serial);
  if (mappingError) throw dbFailure('Could not read the machine\'s employee links', mappingError, device.device_serial);
  const linked = new Set((mappings || []).map((m) => String(m.device_user_id)));
  const normalized = inDates.map((p) => {
    if (linked.has(p.device_user_id)) return p;
    const unpadded = p.device_user_id.replace(/^0+(?=\d)/, '');
    return linked.has(unpadded) ? { ...p, device_user_id: unpadded } : p;
  });

  const key = (p) => `${p.device_user_id}|${new Date(p.punch_time).getTime()}`;
  const unique = [...new Map(normalized.map((p) => [key(p), p])).values()];
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('device_punches')
    .select('device_user_id, punch_time')
    .eq('device_serial', device.device_serial)
    .gte('punch_time', new Date(startMs).toISOString())
    .lte('punch_time', new Date(endMs).toISOString());
  if (existingError) throw dbFailure('Could not read the punches already saved', existingError, device.device_serial);
  const have = new Set((existing || []).map(key));
  const toAdd = unique.filter((p) => !have.has(key(p)));

  const days = {};
  for (const p of toAdd) {
    const day = moment.tz(p.punch_time, TIMEZONE).format('YYYY-MM-DD');
    days[day] = (days[day] || 0) + 1;
  }
  const notLinked = [...new Set(toAdd.filter((p) => !linked.has(p.device_user_id)).map((p) => p.device_user_id))];
  const summary = {
    deviceSerial: device.device_serial,
    from: start.format('YYYY-MM-DD'),
    to: end.format('YYYY-MM-DD'),
    lines: lines.length,
    readable: punches.length,
    unreadable,
    inDates: unique.length,
    alreadyThere: unique.length - toAdd.length,
    toAdd: toAdd.length,
    people: new Set(toAdd.map((p) => p.device_user_id)).size,
    days: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    notLinkedCount: notLinked.length,
    notLinked: notLinked.slice(0, 20),
    dryRun: dryRun !== false,
    saved: 0,
  };
  if (summary.dryRun || !toAdd.length) return summary;

  for (let i = 0; i < toAdd.length; i += IMPORT_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    const result = await savePunches(toAdd.slice(i, i + IMPORT_BATCH), device.device_serial, companyId);
    if (result.error) {
      throw new Error(`Could not save all the punches: ${summary.saved} were added before it stopped. Please try again; ones already added are skipped.`);
    }
    summary.saved += Math.min(IMPORT_BATCH, toAdd.length - i);
  }
  logger.info(`[ADMS] Added ${summary.saved} punch(es) for device ${device.device_serial} from a file (${summary.from} to ${summary.to})`, {
    deviceSerial: device.device_serial, companyId,
  });
  return summary;
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
  emailNewIp,
  getCompanyDevice,
  allowPendingDeviceIp,
  allowDeviceFromIp,
  clearPendingIp,
  rejectPendingDeviceIp,
  handleNewIpContact,
  clearDeviceIpPin,
  isMissingPinColumn,
  parseImportedLines,
  importPunchesFromFile,
};
