const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');
const { getCompanyId } = require('../utils/tenant');
const { runInBackground } = require('../utils/background');
const { BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');

/**
 * A biometric machine calling from a new internet address (IP) — owner's
 * request, 20 Nov 2026.
 *
 * Each machine is pinned to the public IP it reports from (adms.service.js).
 * Until now a push from any other IP was refused, trusting the machine to
 * keep those punches and send them again once the IP was allowed. On 20 Nov
 * 2026 the Spaxads machine did not: the morning's punches never came back.
 *
 * Now a registered machine's punches from a new IP are kept here (the
 * machine is told OK, so it moves on) and count only once that IP is allowed:
 *   - the people chosen in Settings → Attendance → Biometric Devices — every
 *     HR and Admin by default, plus any tech team member ticked there — get
 *     an email and a WhatsApp message with Approve / Reject;
 *   - Approve (WhatsApp, or "Allow new IP" on the website): the machine is
 *     allowed from that IP and the kept punches are saved like any punch, so
 *     attendance is worked out as if they had arrived on time;
 *   - Reject: they stay kept but never count, and nobody is asked about that
 *     IP again for 7 days; if the IP is allowed later, they count then.
 * Nothing else reads the kept punches. Until migration
 * 20261120_adms_kept_punches.sql runs, a push from a new IP is refused as before.
 */

const APPROVERS_KEY = 'device_ip_approvers';
const APPROVER_ROLES = ['admin', 'hr'];
const MAX_TICKED_PEOPLE = 50;
// Far above a real office's backlog (a month of punches for a few hundred people).
const MAX_KEPT_PER_DEVICE = 20000;
const RELEASE_BATCH = 500;
const REJECTED_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_SAVED_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_UNSAVED_MS = 60 * 24 * 60 * 60 * 1000;
const CHECK_TABLES_AGAIN_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_COLUMNS = 'id, company_id, device_serial, ip, previous_ip, status, created_at, decided_at, decided_by, decided_via';
// The WhatsApp message's reason line (approval_request {{5}}, at most 200 characters).
const KEPT_REASON = 'Its punches are kept, not counted, until this is approved. Approve only if your office internet changed (new connection or router restart). If not, tap Reject.';

const tableMissing = (error) => /adms_(kept_punches|ip_requests)/i.test(error?.message || '')
  && /(does not exist|schema cache)/i.test(error.message);

// ── Is the migration in? ───────────────────────────────────────────────────

let tables = { ready: false, checkedAt: 0 };

/** Are the tables there? Once yes, always yes; a no is asked again every 5 minutes. */
const keepingAvailable = async () => {
  if (tables.ready) return true;
  if (Date.now() - tables.checkedAt < CHECK_TABLES_AGAIN_MS) return false;
  const { error } = await supabaseAdmin.from('adms_kept_punches').select('id').limit(1);
  if (!error) {
    tables = { ready: true, checkedAt: Date.now() };
    return true;
  }
  if (tableMissing(error)) {
    tables = { ready: false, checkedAt: Date.now() };
  } else {
    // Not a missing table: ask again in a minute.
    tables = { ready: false, checkedAt: Date.now() - CHECK_TABLES_AGAIN_MS + 60 * 1000 };
    logger.error('[ADMS] Could not check the kept-punches table', { error: error.message });
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
    if (error) throw new BadRequestError(error.message);
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
  if (error) throw new BadRequestError(error.message);
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

// ── Requests ───────────────────────────────────────────────────────────────

const pendingRequest = async (device, ip) => {
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

/** The pending request for this machine and IP, or a new one; null when it can't be recorded. */
const openRequest = async (device, ip) => {
  if (!(await keepingAvailable())) return null;
  const existing = await pendingRequest(device, ip);
  if (existing) return { request: existing, created: false };
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
    })
    .select(REQUEST_COLUMNS)
    .single();
  if (!error && data) return { request: data, created: true };
  // Another push opened it at the same moment (one pending request per machine and IP).
  const again = await pendingRequest(device, ip);
  if (again) return { request: again, created: false };
  logger.error('[ADMS] Could not record a new-IP request', { deviceSerial: device.device_serial, error: error?.message });
  return null;
};

/** Was this IP rejected for this machine in the last 7 days? Then nobody is asked again. */
const recentlyRejected = async (device, ip) => {
  if (!(await keepingAvailable())) return false;
  const { data, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .select('decided_at')
    .eq('company_id', device.company_id)
    .eq('device_serial', device.device_serial)
    .eq('ip', ip)
    .eq('status', 'rejected');
  if (error) return false;
  return (data || []).some((r) => r.decided_at && Date.now() - new Date(r.decided_at).getTime() < REJECTED_QUIET_MS);
};

// ── Kept punches ───────────────────────────────────────────────────────────

const waitingFrom = (query, deviceSerial, companyId, ip) => query
  .eq('device_serial', deviceSerial)
  .eq('company_id', companyId)
  .eq('source_ip', ip)
  .is('released_at', null);

const istTime = (iso) => (iso ? moment.tz(iso, TIMEZONE).format('D MMM, h:mm A') : null);

/** How many punches are kept from `ip` for this machine, and the earliest one. */
const keptSummary = async (deviceSerial, companyId, ip) => {
  if (!(await keepingAvailable())) return { count: 0, since: null, sinceIso: null };
  const [counted, first] = await Promise.all([
    waitingFrom(supabaseAdmin.from('adms_kept_punches').select('id', { count: 'exact', head: true }), deviceSerial, companyId, ip),
    waitingFrom(supabaseAdmin.from('adms_kept_punches').select('punch_time'), deviceSerial, companyId, ip)
      .order('punch_time', { ascending: true })
      .limit(1),
  ]);
  if (counted.error || first.error) return { count: 0, since: null, sinceIso: null };
  const sinceIso = first.data?.[0]?.punch_time || null;
  return { count: counted.count ?? (counted.data || []).length, since: istTime(sinceIso), sinceIso };
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
 * Saves the punches kept from `ip` for this machine as ordinary punches
 * (adms.service.js savePunches: de-duplicated, mapped to employees, and
 * attendance worked out again). Returns how many were saved.
 */
const releaseKept = async (deviceSerial, companyId, ip) => {
  if (!(await keepingAvailable())) return 0;
  const admsService = require('./adms.service');
  let released = 0;
  for (let round = 0; round < 100; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error } = await waitingFrom(
      supabaseAdmin.from('adms_kept_punches').select('id, device_user_id, punch_time, punch_type, verify_mode, raw_data'),
      deviceSerial, companyId, ip,
    ).order('punch_time', { ascending: true }).limit(RELEASE_BATCH);
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
  if (released) {
    logger.info(`[ADMS] Saved ${released} kept punch(es) from device ${deviceSerial} now that ${ip} is allowed`, { deviceSerial, companyId, ip });
  }
  return released;
};

/**
 * Keeps punches a registered machine sent from an IP it isn't allowed yet.
 * True when they are safely kept (the machine is then told OK); false when
 * they could not be (it is told NOK, as before, and should send them again).
 */
const keepPunches = async (device, ip, punches) => {
  if (!(await keepingAvailable())) return false;
  if (!punches.length) return true;
  const { count, data: waiting, error: countError } = await supabaseAdmin
    .from('adms_kept_punches')
    .select('id', { count: 'exact', head: true })
    .eq('device_serial', device.device_serial)
    .is('released_at', null);
  if (countError) {
    logger.error('[ADMS] Could not count kept punches', { deviceSerial: device.device_serial, error: countError.message });
    return false;
  }
  if ((count ?? (waiting || []).length) + punches.length > MAX_KEPT_PER_DEVICE) {
    logger.error(`[ADMS] Device ${device.device_serial} has more than ${MAX_KEPT_PER_DEVICE} punches kept from IPs nobody allowed; refusing more until someone decides`, {
      deviceSerial: device.device_serial, companyId: device.company_id,
    });
    return false;
  }
  const receivedAt = new Date().toISOString();
  const rows = punches.map((p) => ({
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
  logger.warn(`[ADMS] Kept ${rows.length} punch(es) device ${device.device_serial} sent from ${ip}; they count once that IP is allowed`, {
    deviceSerial: device.device_serial, companyId: device.company_id, ip,
  });
  purgeOld();
  // Allowed while this push was on its way: save them now.
  runInBackground('kept punches from an IP just allowed', async () => {
    const admsService = require('./adms.service');
    const current = await admsService.getCompanyDevice(device.device_serial, device.company_id);
    const { ipInCidr } = require('../utils/helpers');
    if (current.allowed_ip && ipInCidr(ip, current.allowed_ip)) await releaseKept(device.device_serial, device.company_id, ip);
  });
  return true;
};

/**
 * The machine is now allowed from `ip` (website "Allow new IP", or the IP it
 * pinned after "Re-learn IP"): its pending request for that IP is approved,
 * and the punches kept from it are saved in the background.
 */
const afterAllowed = async (device, ip, { via, decidedBy = null }) => {
  if (!(await keepingAvailable())) return { kept: 0, since: null };
  const summary = await keptSummary(device.device_serial, device.company_id, ip);
  const { error } = await supabaseAdmin
    .from('adms_ip_requests')
    .update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: decidedBy, decided_via: via })
    .eq('company_id', device.company_id)
    .eq('device_serial', device.device_serial)
    .eq('ip', ip)
    .eq('status', 'pending');
  if (error) logger.error('[ADMS] Could not mark a new-IP request approved', { deviceSerial: device.device_serial, error: error.message });
  if (summary.count) {
    runInBackground('kept punches from an allowed IP', () => releaseKept(device.device_serial, device.company_id, ip));
  }
  return { kept: summary.count, since: summary.since };
};

/**
 * Approve or reject a pending request (WhatsApp, or the website's Reject).
 * Returns { ip, device, kept, since } for the reply.
 */
const decide = async (requestId, decision, { companyId, decidedBy = null, via }) => {
  if (!['approve', 'reject'].includes(decision)) throw new BadRequestError('Choose approve or reject');
  if (!UUID.test(String(requestId || ''))) throw new NotFoundError('this new IP request was not found');
  const { data: request, error } = await supabaseAdmin
    .from('adms_ip_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!request || String(request.company_id) !== String(companyId)) throw new NotFoundError('this new IP request was not found');
  if (request.status !== 'pending') throw new ConflictError(`this new IP was already ${request.status}`);

  const admsService = require('./adms.service');
  const device = await admsService.getCompanyDevice(request.device_serial, request.company_id);
  const summary = await keptSummary(device.device_serial, request.company_id, request.ip);

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
  if (claimError) throw new BadRequestError(claimError.message);
  if (!claimed || !claimed.length) throw new ConflictError('this new IP was already decided');

  try {
    if (decision === 'approve') await admsService.allowDeviceFromIp(device, request.ip, request.previous_ip);
    else await admsService.clearPendingIp(device, request.ip);
  } catch (err) {
    // Nothing changed on the machine: the request waits again.
    await supabaseAdmin
      .from('adms_ip_requests')
      .update({ status: 'pending', decided_at: null, decided_by: null, decided_via: null })
      .eq('id', request.id);
    throw err;
  }
  if (decision === 'approve' && summary.count) {
    runInBackground('kept punches from an approved IP', () => releaseKept(device.device_serial, request.company_id, request.ip));
  }
  logger.info(`[ADMS] New IP ${request.ip} for device ${device.device_serial} ${decision === 'approve' ? 'approved' : 'rejected'} (${via})`, {
    deviceSerial: device.device_serial, companyId: request.company_id, decidedBy,
  });
  return {
    ip: request.ip, device: device.name || device.device_serial, kept: summary.count, since: summary.since,
  };
};

// ── Asking on WhatsApp ─────────────────────────────────────────────────────

/**
 * Queues the approval_request message (Approve / Reject) for the approvers
 * who connected WhatsApp. Sent only where WhatsApp is on for the company and
 * its Security group; one message per person per request.
 */
const askOnWhatsapp = async (device, request, approvers) => {
  const recipients = (approvers || []).map((e) => ({ subjectType: 'employee', subjectId: e.id }));
  if (!recipients.length) return 0;
  const outbox = require('./whatsappOutbox.service');
  const { firstName } = require('./whatsappFormat');
  const { companyName } = require('./whatsappLookup');
  const near = require('./ipGeo.service').lookupRegion(request.ip)?.label;
  return outbox.queueEvent({
    eventKey: 'device_ip_approval',
    source: 'adms:new_ip',
    recordKey: request.id,
    template: 'approval_request',
    group: 'security',
    recipients,
    params: async ({ person, company }) => [
      firstName(person),
      `the biometric machine ${device.name || device.device_serial}`,
      await companyName(company),
      `a new internet address, ${request.ip}${near ? ` (near ${near})` : ''}`,
      KEPT_REASON,
    ],
    action: { kind: 'device_ip', recordId: request.id },
  });
};

module.exports = {
  APPROVERS_KEY,
  APPROVER_ROLES,
  KEPT_REASON,
  MAX_KEPT_PER_DEVICE,
  keepingAvailable,
  normalizeApprovers,
  getApprovers,
  saveApprovers,
  approverEmployees,
  isApprover,
  openRequest,
  recentlyRejected,
  keptSummary,
  keepPunches,
  releaseKept,
  afterAllowed,
  decide,
  askOnWhatsapp,
  _resetForTests: () => { tables = { ready: false, checkedAt: 0 }; lastPurgeAt = 0; },
};
