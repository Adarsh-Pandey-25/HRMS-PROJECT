const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');
const { getCompanyId } = require('../utils/tenant');
const { runInBackground } = require('../utils/background');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');

/**
 * A biometric machine calling from a new internet address (IP). Owner's
 * rules, 20 Nov 2026:
 *
 * Each machine is pinned to the public IP it reports from (adms.service.js).
 * A refused push is not always sent again (the Spaxads machine dropped a
 * morning's punches on 20 Nov), so a registered machine's punches from a new
 * IP are kept here and the machine is told OK. Nothing reads them until a
 * person decides:
 *   - One request per machine and new IP. The people chosen in Settings →
 *     Attendance → Biometric Devices (every HR and Admin by default, plus
 *     anyone ticked; only an Admin changes the list) are told by email, and on
 *     WhatsApp: with Approve / Reject when they connected WhatsApp themselves
 *     (JOIN), otherwise a message without buttons.
 *   - Every message shows the new and old IP with their area, how many punches
 *     by how many people over which times, and a warning when the machine was
 *     still online on its old IP just before (an office change rarely looks
 *     like that; a copied serial number does).
 *   - Approve: the machine is allowed from that IP and its kept punches count,
 *     at the times they were made. Only punches from when the machine was last
 *     seen on its allowed IP onward (at most 7 days back): a back-dated punch
 *     never fills an old absent day.
 *   - Reject: the kept punches are deleted. If that IP keeps sending, its
 *     punches are kept again under a new request, shown on the website but
 *     not announced again for 7 days.
 *   - At most 5 waiting IPs per machine and 5,000 kept punches per IP (20,000
 *     per machine); beyond that the push is refused (NOK).
 * Until migration 20261120_adms_kept_punches.sql runs, a push from a new IP is
 * refused as before.
 */

const APPROVERS_KEY = 'device_ip_approvers';
const APPROVER_ROLES = ['admin', 'hr'];
const MAX_TICKED_PEOPLE = 50;
const MAX_OPEN_REQUESTS_PER_DEVICE = 5;
const MAX_KEPT_PER_IP = 5000;
const MAX_KEPT_PER_DEVICE = 20000;
const RELEASE_BATCH = 500;
// Punches count from an hour before the machine was last seen on its allowed IP…
const WINDOW_MARGIN_MS = 60 * 60 * 1000;
// …or the last day when it was never seen, and never more than 7 days back.
const WINDOW_UNKNOWN_MS = 24 * 60 * 60 * 1000;
const WINDOW_MAX_MS = 7 * 24 * 60 * 60 * 1000;
// Seen on its allowed IP this shortly before a new one appeared: warn the approver.
const STILL_ONLINE_MS = 10 * 60 * 1000;
const REJECTED_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_SAVED_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_UNSAVED_MS = 60 * 24 * 60 * 60 * 1000;
const CHECK_TABLES_AGAIN_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_COLUMNS = 'id, company_id, device_serial, ip, previous_ip, status, created_at, decided_at, decided_by, decided_via, window_start';

const tableMissing = (error) => /adms_(kept_punches|ip_requests)/i.test(error?.message || '')
  && /(does not exist|schema cache)/i.test(error.message);

const countOf = (result) => result.count ?? (result.data || []).length;

// ── Is the migration in? ───────────────────────────────────────────────────

let tables = { ready: false, checkedAt: 0 };

/** Are the tables there? Once yes, always yes; a no is asked again every 5 minutes. */
const keepingAvailable = async () => {
  if (tables.ready) return true;
  if (Date.now() - tables.checkedAt < CHECK_TABLES_AGAIN_MS) return false;
  const { error } = await supabaseAdmin.from('adms_ip_requests').select('id, window_start').limit(1);
  if (!error) {
    tables = { ready: true, checkedAt: Date.now() };
    return true;
  }
  if (tableMissing(error) || /window_start/.test(error.message || '')) {
    tables = { ready: false, checkedAt: Date.now() };
  } else {
    // Not a missing table: ask again in a minute.
    tables = { ready: false, checkedAt: Date.now() - CHECK_TABLES_AGAIN_MS + 60 * 1000 };
    logger.error('[ADMS] Could not check the new-IP tables', { error: error.message });
  }
  return false;
};

// ── Who approves (Settings → Attendance → Biometric Devices) ───────────────

/** { roles, employeeIds }: every HR and Admin by default, plus the people ticked. */
const normalizeApprovers = (value) => {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const roles = Array.isArray(v.roles) ? APPROVER_ROLES.filter((role) => v.roles.includes(role)) : [...APPROVER_ROLES];
  const employeeIds = Array.isArray(v.employeeIds)
    ? [...new Set(v.employeeIds.map((id) => String(id)).filter((id) => UUID.test(id)))].slice(0, MAX_TICKED_PEOPLE)
    : [];
  return { roles, employeeIds };
};

const getApprovers = async (companyId) => {
  const settingsService = require('./settings.service');
  return normalizeApprovers(await settingsService.getSetting(APPROVERS_KEY, null, companyId));
};

/** Saves who approves; only active people of this company can be ticked, and someone must be chosen. */
const saveApprovers = async (companyId, value, updatedBy) => {
  const next = normalizeApprovers(value);
  if (next.employeeIds.length) {
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('id, company_id, address, is_active')
      .in('id', next.employeeIds);
    if (error) {
      logger.error('[ADMS] Could not check the people chosen to approve a new IP', { error: error.message });
      throw new Error('Could not save who approves a new IP. Please try again.');
    }
    const theirs = new Set((data || [])
      .filter((e) => e.is_active !== false && getCompanyId(e) === String(companyId))
      .map((e) => e.id));
    next.employeeIds = next.employeeIds.filter((id) => theirs.has(id));
  }
  if (!next.roles.length && !next.employeeIds.length) {
    throw new BadRequestError('Choose at least one person to approve a new IP');
  }
  const settingsService = require('./settings.service');
  const { error } = await settingsService.setSetting(APPROVERS_KEY, next, updatedBy, companyId);
  if (error) {
    logger.error('[ADMS] Could not save who approves a new IP', { error: error.message });
    throw new Error('Could not save who approves a new IP. Please try again.');
  }
  return next;
};

/** The active people of a company who are asked to approve a new IP. */
const approverEmployees = async (companyId) => {
  const { roles, employeeIds } = await getApprovers(companyId);
  const columns = 'id, first_name, last_name, email, role, is_active, company_id';
  const found = new Map();
  const add = ({ data }) => (data || []).forEach((e) => found.set(e.id, e));
  if (roles.length) {
    add(await supabaseAdmin.from('employees').select(columns)
      .eq('company_id', companyId).eq('is_active', true).in('role', roles));
  }
  if (employeeIds.length) {
    add(await supabaseAdmin.from('employees').select(columns)
      .eq('company_id', companyId).eq('is_active', true).in('id', employeeIds));
  }
  return [...found.values()];
};

/** May this signed-in person approve a new IP for their company's machines? */
const isApprover = async (employee) => {
  if (!employee?.id || employee.is_active === false) return false;
  const { roles, employeeIds } = await getApprovers(getCompanyId(employee));
  return roles.includes(employee.role) || employeeIds.includes(String(employee.id));
};

/**
 * Of these employees, the ones whose WhatsApp is confirmed (JOIN, or a code):
 * only they get buttons (whatsappVerify.service.js).
 */
const verifiedApproverIds = (employeeIds) => require('./whatsappVerify.service').confirmedEmployeeIds(employeeIds);

// ── Requests ───────────────────────────────────────────────────────────────

/**
 * From when a new IP's punches can count: an hour before the machine was last
 * seen on its allowed IP (the gap starts there), or the last day when it was
 * never seen; never more than 7 days back.
 */
const windowStartFor = (device, now = Date.now()) => {
  const seen = device?.last_seen_at ? new Date(device.last_seen_at).getTime() : NaN;
  const start = Number.isFinite(seen) ? seen - WINDOW_MARGIN_MS : now - WINDOW_UNKNOWN_MS;
  return new Date(Math.min(now, Math.max(start, now - WINDOW_MAX_MS))).toISOString();
};

/** The pending request for this machine and IP, or null. */
const pendingRequestFor = async (device, ip) => {
  const { data, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .select(REQUEST_COLUMNS)
    .eq('company_id', device.company_id)
    .eq('device_serial', device.device_serial)
    .eq('ip', ip)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) {
    if (!tableMissing(error)) logger.error('[ADMS] Could not read a new-IP request', { error: error.message });
    return null;
  }
  return data || null;
};

/**
 * The pending request for this machine and IP, or a new one. Null when it
 * can't be recorded, or the machine already has 5 IPs waiting: the push is
 * then refused, and nothing is kept.
 */
const openRequest = async (device, ip) => {
  if (!(await keepingAvailable())) return null;
  const existing = await pendingRequestFor(device, ip);
  if (existing) return { request: existing, created: false };

  const waiting = await supabaseAdmin
    .from('adms_ip_requests')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', device.company_id)
    .eq('device_serial', device.device_serial)
    .eq('status', 'pending');
  if (waiting.error) {
    logger.error('[ADMS] Could not count a machine\'s waiting IPs', { deviceSerial: device.device_serial, error: waiting.error.message });
    return null;
  }
  if (countOf(waiting) >= MAX_OPEN_REQUESTS_PER_DEVICE) {
    logger.warn(`[ADMS] Device ${device.device_serial} already has ${MAX_OPEN_REQUESTS_PER_DEVICE} new IPs waiting; refusing ${ip} until someone decides`, {
      deviceSerial: device.device_serial, companyId: device.company_id, ip,
    });
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .insert({
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      company_id: device.company_id,
      device_serial: device.device_serial,
      ip,
      previous_ip: device.allowed_ip || null,
      status: 'pending',
      window_start: windowStartFor(device),
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (!error && data) return { request: data, created: true };
  // Another push opened it at the same moment (one pending request per machine and IP).
  const again = await pendingRequestFor(device, ip);
  if (again) return { request: again, created: false };
  logger.error('[ADMS] Could not record a new-IP request', { deviceSerial: device.device_serial, error: error?.message });
  return null;
};

/** When this IP was last rejected for this machine, or null. */
const lastRejectedAt = async (companyId, deviceSerial, ip) => {
  const { data, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .select('decided_at')
    .eq('company_id', companyId)
    .eq('device_serial', deviceSerial)
    .eq('ip', ip)
    .eq('status', 'rejected');
  if (error) return null;
  const times = (data || []).map((r) => r.decided_at).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
  return times.length ? times[times.length - 1] : null;
};

// ── Kept punches ───────────────────────────────────────────────────────────

const waitingFrom = (query, deviceSerial, companyId, ip) => query
  .eq('device_serial', deviceSerial)
  .eq('company_id', companyId)
  .eq('source_ip', ip)
  .is('released_at', null);

const istTime = (iso) => (iso ? moment.tz(iso, TIMEZONE).format('D MMM, h:mm A') : null);

/** "20 Nov, 9:30 AM – 10:15 AM" or "19 Nov, 6:02 PM – 20 Nov, 9:41 AM". */
const istRange = (firstIso, lastIso) => {
  if (!firstIso) return '';
  const first = moment.tz(firstIso, TIMEZONE);
  const last = moment.tz(lastIso || firstIso, TIMEZONE);
  if (first.isSame(last, 'minute')) return first.format('D MMM, h:mm A');
  return first.isSame(last, 'day')
    ? `${first.format('D MMM, h:mm A')} – ${last.format('h:mm A')}`
    : `${first.format('D MMM, h:mm A')} – ${last.format('D MMM, h:mm A')}`;
};

const EMPTY_SUMMARY = Object.freeze({ count: 0, people: 0, firstIso: null, lastIso: null, since: null });

/** The punches kept from `ip` for this machine that would count on approval (from `windowStart` on). */
const keptSummary = async (deviceSerial, companyId, ip, windowStart = null) => {
  if (!(await keepingAvailable())) return { ...EMPTY_SUMMARY };
  let query = waitingFrom(supabaseAdmin.from('adms_kept_punches').select('device_user_id, punch_time'), deviceSerial, companyId, ip);
  if (windowStart) query = query.gte('punch_time', windowStart);
  const { data, error } = await query.order('punch_time', { ascending: true }).limit(MAX_KEPT_PER_IP);
  if (error || !data || !data.length) return { ...EMPTY_SUMMARY };
  const times = data.map((r) => r.punch_time).sort((a, b) => new Date(a) - new Date(b));
  return {
    count: data.length,
    people: new Set(data.map((r) => r.device_user_id)).size,
    firstIso: times[0],
    lastIso: times[times.length - 1],
    since: istTime(times[0]),
  };
};

let lastPurgeAt = 0;

/** Removes saved rows after 7 days and never-allowed ones after 60, on the way in (at most hourly). */
const purgeOld = () => {
  const now = Date.now();
  if (now - lastPurgeAt < 60 * 60 * 1000) return;
  lastPurgeAt = now;
  runInBackground('kept-punch purge', async () => {
    await supabaseAdmin.from('adms_kept_punches').delete()
      .lt('received_at', new Date(now - KEEP_UNSAVED_MS).toISOString());
    await supabaseAdmin.from('adms_kept_punches').delete()
      .lt('released_at', new Date(now - KEEP_SAVED_MS).toISOString());
  });
};

/**
 * Saves the punches kept from `ip` for this machine, from `windowStart` on,
 * as ordinary punches (adms.service.js savePunches: de-duplicated, mapped to
 * employees, attendance worked out again); older ones are deleted, never
 * counted. Returns how many were saved.
 */
const releaseKept = async (deviceSerial, companyId, ip, windowStart = null) => {
  if (!(await keepingAvailable())) return 0;
  const admsService = require('./adms.service');
  let released = 0;
  for (let round = 0; round < 100; round += 1) {
    let query = waitingFrom(
      supabaseAdmin.from('adms_kept_punches').select('id, device_user_id, punch_time, punch_type, verify_mode, raw_data'),
      deviceSerial, companyId, ip,
    );
    if (windowStart) query = query.gte('punch_time', windowStart);
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error } = await query.order('punch_time', { ascending: true }).limit(RELEASE_BATCH);
    if (error) {
      logger.error('[ADMS] Could not read kept punches', { deviceSerial, error: error.message });
      break;
    }
    if (!rows || !rows.length) break;
    const punches = rows.map((r) => ({
      device_user_id: r.device_user_id,
      punch_time: r.punch_time,
      punch_type: r.punch_type,
      verify_mode: r.verify_mode,
      device_serial: deviceSerial,
      raw_data: r.raw_data,
    }));
    // eslint-disable-next-line no-await-in-loop
    const saved = await admsService.savePunches(punches, deviceSerial, companyId);
    if (saved.error) break; // still kept; saved the next time this IP is allowed
    // eslint-disable-next-line no-await-in-loop
    const { error: markError } = await supabaseAdmin
      .from('adms_kept_punches')
      .update({ released_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id));
    if (markError) {
      logger.error('[ADMS] Could not mark kept punches as saved', { deviceSerial, error: markError.message });
      break;
    }
    released += rows.length;
    if (rows.length < RELEASE_BATCH) break;
  }
  if (windowStart) {
    const { error } = await waitingFrom(supabaseAdmin.from('adms_kept_punches').delete(), deviceSerial, companyId, ip)
      .lt('punch_time', windowStart);
    if (error) logger.error('[ADMS] Could not delete kept punches dated before the gap', { deviceSerial, error: error.message });
  }
  if (released) {
    logger.info(`[ADMS] Saved ${released} kept punch(es) from device ${deviceSerial} now that ${ip} is allowed`, { deviceSerial, companyId, ip });
  }
  return released;
};

/** Deletes the punches kept from `ip` for this machine that never counted (Reject). */
const deleteKept = async (deviceSerial, companyId, ip) => {
  const { error } = await waitingFrom(supabaseAdmin.from('adms_kept_punches').delete(), deviceSerial, companyId, ip);
  if (error) {
    logger.error('[ADMS] Could not delete rejected punches', { deviceSerial, error: error.message });
    throw new Error('Could not delete the punches from this IP. Nothing was changed; please try again.');
  }
};

/**
 * Keeps punches a registered machine sent from an IP it isn't allowed yet,
 * under that IP's pending `request`. Punches dated before the request's
 * window are not kept: they would never count. True when the rest are kept
 * (the machine is then told OK); false when they could not be (told NOK).
 */
const keepPunches = async (device, ip, punches, request) => {
  if (!request || !(await keepingAvailable())) return false;
  const from = request.window_start ? new Date(request.window_start).getTime() : null;
  const fresh = from ? punches.filter((p) => new Date(p.punch_time).getTime() >= from) : punches;
  if (fresh.length < punches.length) {
    logger.warn(`[ADMS] ${punches.length - fresh.length} punch(es) device ${device.device_serial} sent from ${ip} are dated before it was last seen on its allowed IP; not kept`, {
      deviceSerial: device.device_serial, companyId: device.company_id, ip,
    });
  }
  if (!fresh.length) return true;

  const [fromIp, fromDevice] = await Promise.all([
    waitingFrom(supabaseAdmin.from('adms_kept_punches').select('id', { count: 'exact', head: true }), device.device_serial, device.company_id, ip),
    supabaseAdmin.from('adms_kept_punches').select('id', { count: 'exact', head: true })
      .eq('device_serial', device.device_serial)
      .eq('company_id', device.company_id)
      .is('released_at', null),
  ]);
  if (fromIp.error || fromDevice.error) {
    logger.error('[ADMS] Could not count kept punches', { deviceSerial: device.device_serial, error: (fromIp.error || fromDevice.error).message });
    return false;
  }
  if (countOf(fromIp) + fresh.length > MAX_KEPT_PER_IP || countOf(fromDevice) + fresh.length > MAX_KEPT_PER_DEVICE) {
    logger.error(`[ADMS] Device ${device.device_serial} has too many punches kept from IPs nobody allowed (${MAX_KEPT_PER_IP} per IP, ${MAX_KEPT_PER_DEVICE} per machine); refusing more until someone decides`, {
      deviceSerial: device.device_serial, companyId: device.company_id, ip,
    });
    return false;
  }

  const receivedAt = new Date().toISOString();
  const rows = fresh.map((p) => ({
    id: crypto.randomUUID(),
    received_at: receivedAt,
    company_id: device.company_id,
    device_serial: device.device_serial,
    source_ip: ip,
    device_user_id: p.device_user_id,
    punch_time: p.punch_time,
    punch_type: p.punch_type,
    verify_mode: p.verify_mode || null,
    raw_data: p.raw_data || null,
  }));
  const { error } = await supabaseAdmin
    .from('adms_kept_punches')
    .upsert(rows, { onConflict: 'device_serial,source_ip,device_user_id,punch_time', ignoreDuplicates: true });
  if (error) {
    logger.error('[ADMS] Could not keep punches from a new IP', { deviceSerial: device.device_serial, error: error.message });
    return false;
  }
  logger.warn(`[ADMS] Kept ${rows.length} punch(es) device ${device.device_serial} sent from ${ip}; they count once that IP is approved`, {
    deviceSerial: device.device_serial, companyId: device.company_id, ip,
  });
  purgeOld();
  // Approved while this push was on its way: save them now.
  runInBackground('kept punches from an IP just approved', async () => {
    const admsService = require('./adms.service');
    const current = await admsService.getCompanyDevice(device.device_serial, device.company_id);
    const { ipInCidr } = require('../utils/helpers');
    if (current.allowed_ip && ipInCidr(ip, current.allowed_ip)) {
      await releaseKept(device.device_serial, device.company_id, ip, request.window_start);
    }
  });
  return true;
};

// ── Telling the approvers ──────────────────────────────────────────────────

/**
 * What the approvers are shown about a request: the new and old IP with
 * their area, the punches so far, and whether the machine was still online on
 * its old IP just before the new one appeared.
 */
const describeRequest = (device, request, summary) => {
  const geo = require('./ipGeo.service');
  const withArea = (ip) => {
    if (!ip) return 'none';
    const near = geo.lookupRegion(ip)?.label;
    return near ? `${ip} (near ${near})` : ip;
  };
  const seen = device?.last_seen_at ? new Date(device.last_seen_at).getTime() : NaN;
  const createdAt = request?.created_at ? new Date(request.created_at).getTime() : Date.now();
  const stillOnline = Number.isFinite(seen) && createdAt - seen < STILL_ONLINE_MS;
  const n = summary?.count || 0;
  const people = summary?.people || 0;
  return {
    machine: device?.name || device?.device_serial || request?.device_serial,
    newIp: withArea(request?.ip),
    previousIp: withArea(request?.previous_ip),
    punches: n
      ? `${n} ${n === 1 ? 'punch' : 'punches'} by ${people} ${people === 1 ? 'person' : 'people'}, ${istRange(summary.firstIso, summary.lastIso)}`
      : 'no punches yet',
    stillOnline,
    lastSeen: Number.isFinite(seen) ? moment.tz(seen, TIMEZONE).format('h:mm A') : null,
  };
};

/** The WhatsApp reason line (approval_request {{5}}, at most 200 characters). */
const reasonLine = (text) => {
  const warning = text.stillOnline ? `Careful: it was online on the old address at ${text.lastSeen}. ` : '';
  return `${warning}So far ${text.punches}. They count only if you approve; Reject deletes them.`;
};

/**
 * Queues the WhatsApp message for the approvers who connected WhatsApp:
 * with Approve / Reject for those who confirmed their number (JOIN, or a
 * code), and without buttons (approval_waiting, "review it in SpaxSync") for
 * the rest, who are also sent a code when the company's setting is on.
 * Sent only where WhatsApp is on for the company and its Security group.
 */
const askOnWhatsapp = async (device, request, approvers, text) => {
  const ids = (approvers || []).map((e) => e.id);
  if (!ids.length) return 0;
  const verified = await verifiedApproverIds(ids);
  const outbox = require('./whatsappOutbox.service');
  const { firstName } = require('./whatsappFormat');
  const { companyName } = require('./whatsappLookup');
  const recipients = (list) => list.map((subjectId) => ({ subjectType: 'employee', subjectId }));
  const withButtons = ids.filter((id) => verified.has(id));
  const withoutButtons = ids.filter((id) => !verified.has(id));
  const what = `the biometric machine ${text.machine}`;

  let queued = 0;
  if (withButtons.length) {
    queued += await outbox.queueEvent({
      eventKey: 'device_ip_approval',
      source: 'adms:new_ip',
      recordKey: request.id,
      template: 'approval_request',
      group: 'security',
      recipients: recipients(withButtons),
      params: async ({ person, company }) => [
        firstName(person), what, await companyName(company),
        `a new internet address ${text.newIp}; before: ${text.previousIp}`,
        reasonLine(text),
      ],
      action: { kind: 'device_ip', recordId: request.id },
    });
  }
  if (withoutButtons.length) {
    queued += await outbox.queueEvent({
      eventKey: 'device_ip_waiting',
      source: 'adms:new_ip',
      recordKey: request.id,
      template: 'approval_waiting',
      group: 'security',
      recipients: recipients(withoutButtons),
      params: async ({ person, company }) => [
        firstName(person), what, await companyName(company),
        `a new internet address ${text.newIp} (before: ${text.previousIp}); so far ${text.punches}`,
      ],
    });
    require('./whatsappVerify.service').nudgeUnconfirmed(request.company_id, withoutButtons)
      .catch((e) => logger.warn('[ADMS] Could not send confirmation codes', { error: e.message }));
  }
  return queued;
};

/**
 * Tells the approvers about a request just opened: by email, and on WhatsApp.
 * An IP rejected for this machine in the last 7 days is not announced again
 * (its punches are kept and shown on the website).
 */
const notifyNewRequest = async (device, request) => {
  const rejectedAt = await lastRejectedAt(request.company_id, request.device_serial, request.ip);
  if (rejectedAt && Date.now() - new Date(rejectedAt).getTime() < REJECTED_QUIET_MS) {
    logger.warn(`[ADMS] Device ${request.device_serial} is sending from ${request.ip} again, rejected on ${rejectedAt}; kept, not announced again`, {
      deviceSerial: request.device_serial, companyId: request.company_id, ip: request.ip,
    });
    return { emailed: false, asked: 0, quiet: true };
  }
  const approvers = await approverEmployees(request.company_id).catch(() => []);
  const summary = await keptSummary(request.device_serial, request.company_id, request.ip, request.window_start);
  const text = describeRequest(device, request, summary);
  await require('./adms.service').emailNewIp(device, request.ip, { kept: true, text, approvers })
    .catch((e) => logger.error('[ADMS] Could not email about a new device IP', { deviceSerial: request.device_serial, error: e.message }));
  const asked = await askOnWhatsapp(device, request, approvers, text)
    .catch((e) => {
      logger.error('[ADMS] Could not ask on WhatsApp about a new device IP', { deviceSerial: request.device_serial, error: e.message });
      return 0;
    });
  return { emailed: true, asked, quiet: false };
};

// ── Deciding ───────────────────────────────────────────────────────────────

/**
 * Approve or reject a pending request (website or WhatsApp).
 *  - Approve: the machine is allowed from the request's IP and the punches
 *    kept from it since the gap began count. From WhatsApp the machine must
 *    still be allowed from the IP the message showed, so an old message can't
 *    undo a newer change; the website decides on what the page shows now.
 *  - Reject: the punches kept from that IP are deleted.
 * Returns { ip, device, kept, people, since } for the reply.
 */
const decide = async (requestId, decision, { companyId, decidedBy = null, via }) => {
  if (!['approve', 'reject'].includes(decision)) throw new BadRequestError('Choose approve or reject');
  if (!UUID.test(String(requestId || ''))) throw new NotFoundError('this new IP request was not found');
  const { data: request, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', requestId)
    .maybeSingle();
  if (error) {
    logger.error('[ADMS] Could not load a new-IP request', { requestId, error: error.message });
    throw new Error('Could not load this request. Please try again.');
  }
  if (!request || String(request.company_id) !== String(companyId)) throw new NotFoundError('this new IP request was not found');
  if (request.status !== 'pending') throw new ConflictError(`this new IP was already ${request.status}`);

  const admsService = require('./adms.service');
  const device = await admsService.getCompanyDevice(request.device_serial, request.company_id);
  const summary = await keptSummary(device.device_serial, request.company_id, request.ip, request.window_start);

  // Claimed first, so two taps at the same moment can't both act.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('adms_ip_requests')
    .update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: decidedBy,
      decided_via: via,
    })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('id');
  if (claimError) {
    logger.error('[ADMS] Could not record a new-IP decision', { requestId, error: claimError.message });
    throw new Error('Could not record the decision. Please try again.');
  }
  if (!claimed || !claimed.length) throw new ConflictError('this new IP was already decided');

  try {
    if (decision === 'approve') {
      await admsService.allowDeviceFromIp(device, request.ip, request.previous_ip, { checkPrevious: via !== 'website' });
    } else {
      await deleteKept(device.device_serial, request.company_id, request.ip);
      await admsService.clearPendingIp(device, request.ip);
    }
  } catch (err) {
    // Nothing changed on the machine: the request waits again.
    await supabaseAdmin
      .from('adms_ip_requests')
      .update({ status: 'pending', decided_at: null, decided_by: null, decided_via: null })
      .eq('id', request.id);
    throw err;
  }
  if (decision === 'approve') {
    runInBackground('kept punches from an approved IP', () => releaseKept(device.device_serial, request.company_id, request.ip, request.window_start));
  }
  logger.info(`[ADMS] New IP ${request.ip} for device ${device.device_serial} ${decision === 'approve' ? 'approved' : 'rejected'} (${via})`, {
    deviceSerial: device.device_serial, companyId: request.company_id, decidedBy, kept: summary.count,
  });
  return {
    ip: request.ip,
    device: device.name || device.device_serial,
    kept: summary.count,
    people: summary.people,
    since: summary.since,
  };
};

// ── The website's list ─────────────────────────────────────────────────────

/** A company's waiting new IPs, with what each would add if approved. */
const listRequests = async (companyId) => {
  if (!(await keepingAvailable())) return [];
  const { data, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .select(REQUEST_COLUMNS)
    .eq('company_id', companyId)
    .eq('status', 'pending');
  if (error) {
    logger.error('[ADMS] Could not list new-IP requests', { error: error.message });
    return [];
  }
  const geo = require('./ipGeo.service');
  return Promise.all((data || []).map(async (r) => {
    const [summary, rejectedAt] = await Promise.all([
      keptSummary(r.device_serial, companyId, r.ip, r.window_start),
      lastRejectedAt(companyId, r.device_serial, r.ip),
    ]);
    return {
      id: r.id,
      deviceSerial: r.device_serial,
      ip: r.ip,
      near: geo.lookupRegion(r.ip)?.label || null,
      previousIp: r.previous_ip || null,
      previousNear: r.previous_ip ? geo.lookupRegion(r.previous_ip)?.label || null : null,
      createdAt: r.created_at,
      countsFrom: r.window_start || null,
      kept: summary.count,
      people: summary.people,
      firstPunchAt: summary.firstIso,
      lastPunchAt: summary.lastIso,
      rejectedBefore: rejectedAt,
    };
  }));
};

/** A machine changing hands (release, or a fresh claim): its requests and kept punches go. */
const purgeForSerial = async (deviceSerial) => {
  for (const table of ['adms_kept_punches', 'adms_ip_requests']) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabaseAdmin.from(table).delete().eq('device_serial', deviceSerial);
    if (error && !tableMissing(error)) logger.error('[ADMS] Could not clear a released machine\'s new-IP data', { deviceSerial, table, error: error.message });
  }
};

module.exports = {
  APPROVERS_KEY,
  APPROVER_ROLES,
  MAX_OPEN_REQUESTS_PER_DEVICE,
  MAX_KEPT_PER_IP,
  MAX_KEPT_PER_DEVICE,
  keepingAvailable,
  normalizeApprovers,
  getApprovers,
  saveApprovers,
  approverEmployees,
  isApprover,
  verifiedApproverIds,
  windowStartFor,
  pendingRequestFor,
  openRequest,
  lastRejectedAt,
  keptSummary,
  keepPunches,
  releaseKept,
  deleteKept,
  describeRequest,
  reasonLine,
  askOnWhatsapp,
  notifyNewRequest,
  decide,
  listRequests,
  purgeForSerial,
  _resetForTests: () => { tables = { ready: false, checkedAt: 0 }; lastPurgeAt = 0; },
};
