const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getConfig, canSend, isRecipientAllowed } = require('../config/whatsapp');
const { BadRequestError, TooManyRequestsError } = require('../utils/errors');
const { MARKETING_GROUPS, groupsForRole, sanitizeGroups, describeGroups } = require('./whatsappGroups');
const { maskPhone, firstName } = require('./whatsappFormat');
const settings = require('./whatsappSettings.service');
const { companyName } = require('./whatsappLookup');

/**
 * Connecting a person's WhatsApp. A person can do it themselves: SpaxSync
 * shows a one-time code and a wa.me link with "JOIN <code>" typed in; they
 * press Send in WhatsApp, and the webhook links the number Meta reports for
 * that message to their account. That single tap proves the number is
 * theirs, records their agreement (Meta requires opt-in naming the business)
 * and costs nothing.
 *
 * Codes are random, single-use, valid 15 minutes, and only their SHA-256 is
 * stored.
 *
 * Since 2 Nov 2026 (owner's decision) an employee HR adds is also connected
 * straight away to the mobile number HR entered, without a JOIN, and gets a
 * first message saying so (connectAddedEmployee). If that number is changed
 * later, the connection follows it (followNumberChange). A super admin can
 * connect a company's existing employees the same way, in one go, when the
 * owner decides (connectExistingEmployees).
 */

const CONSENT_VERSION = '2026-10-28';
const CODE_LENGTH = 8;
// No 0/O, 1/I/L — easy to read back if someone types the code by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODES_PER_HOUR = 6;

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');

const newCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
};

const consentText = (subjectType, companyName) => (subjectType === 'super_admin'
  ? 'I agree to receive SpaxSync platform alerts on WhatsApp, sent by SpaxSync through Meta. I can stop at any time by replying STOP or switching it off in SpaxSync.'
  : `I agree to receive HR updates from ${companyName || 'my company'} on WhatsApp, sent by SpaxSync through Meta. I can stop at any time by replying STOP or switching it off in SpaxSync.`);

/** Starts connecting: returns the wa.me link the person opens. */
const startLink = async ({ subjectType, subjectId, companyId = null, companyName = null }) => {
  const cfg = getConfig();
  if (!cfg.businessNumber) throw new BadRequestError('WhatsApp is not set up yet. Please try again later.');

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('whatsapp_link_codes')
    .select('id', { count: 'exact', head: true })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .gte('created_at', since);
  if ((count || 0) >= MAX_CODES_PER_HOUR) {
    throw new TooManyRequestsError('Too many connect attempts. Please wait an hour and try again.');
  }

  // Any older unused code for this person stops working.
  await supabaseAdmin
    .from('whatsapp_link_codes')
    .update({ expires_at: new Date().toISOString() })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .is('used_at', null);

  const code = newCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from('whatsapp_link_codes').insert({
    code_hash: hashCode(code),
    subject_type: subjectType,
    subject_id: subjectId,
    company_id: companyId,
    expires_at: expiresAt,
  });
  if (error) throw new BadRequestError(error.message);

  const message = `JOIN ${code}`;
  return {
    code,
    message,
    link: `https://wa.me/${cfg.businessNumber}?text=${encodeURIComponent(message)}`,
    businessNumber: `+${cfg.businessNumber}`,
    expiresAt,
    consentText: consentText(subjectType, companyName),
    consentVersion: CONSENT_VERSION,
  };
};

/**
 * Finishes connecting when "JOIN <code>" arrives. The code is marked used in
 * the same conditional update that finds it, so it can never link twice.
 * Returns the linked subject, or null if the code is unknown/expired/used.
 */
const completeLink = async ({ code, phone: rawPhone, bsuid: rawBsuid }) => {
  const { phone, bsuid } = normalizeIdentity({ phone: rawPhone, bsuid: rawBsuid });
  if (!phone && !bsuid) return null;
  const now = new Date().toISOString();
  const { data: claimed, error } = await supabaseAdmin
    .from('whatsapp_link_codes')
    .update({ used_at: now })
    .eq('code_hash', hashCode(code))
    .is('used_at', null)
    .gt('expires_at', now)
    .select('subject_type, subject_id, company_id')
    .maybeSingle();
  if (error || !claimed) return null;

  const { data: company } = claimed.company_id
    ? await supabaseAdmin.from('companies').select('name').eq('id', claimed.company_id).maybeSingle()
    : { data: null };

  const { error: linkError } = await supabaseAdmin.from('whatsapp_links').upsert({
    subject_type: claimed.subject_type,
    subject_id: claimed.subject_id,
    company_id: claimed.company_id,
    phone: phone || null,
    bsuid: bsuid || null,
    status: 'active',
    consent_version: CONSENT_VERSION,
    consented_at: now,
    consent_source: 'whatsapp_join',
    opted_out_at: null,
    updated_at: now,
  }, { onConflict: 'subject_type,subject_id' });
  if (linkError) throw new BadRequestError(linkError.message);

  return {
    subjectType: claimed.subject_type,
    subjectId: claimed.subject_id,
    companyId: claimed.company_id,
    companyName: company?.name || null,
  };
};

/**
 * Meta's ids, reduced to the characters they can legitimately contain —
 * phone numbers are digits, BSUIDs are "CC." plus letters and digits — so a
 * value can never alter the filter it is placed in.
 */
const normalizeIdentity = ({ phone, bsuid } = {}) => {
  const digits = String(phone || '').replace(/\D/g, '');
  const id = String(bsuid || '').trim();
  return {
    phone: digits.length >= 8 && digits.length <= 15 ? digits : null,
    bsuid: /^[A-Za-z]{2}\.[A-Za-z0-9]{1,150}$/.test(id) ? id : null,
  };
};

/** The rows for whoever sent a message: matched by number, or by BSUID. */
const identityFilter = (query, identity) => {
  const { phone, bsuid } = normalizeIdentity(identity);
  if (phone && bsuid) return query.or(`phone.eq.${phone},bsuid.eq.${bsuid}`);
  if (phone) return query.eq('phone', phone);
  return query.eq('bsuid', bsuid);
};

const hasIdentity = (identity) => {
  const { phone, bsuid } = normalizeIdentity(identity);
  return Boolean(phone || bsuid);
};

/** "STOP": every link for this WhatsApp stops at once. Returns how many. */
const optOut = async (identity) => {
  if (!hasIdentity(identity)) return 0;
  const now = new Date().toISOString();
  const { data } = await identityFilter(
    supabaseAdmin.from('whatsapp_links').update({ status: 'opted_out', opted_out_at: now, updated_at: now }),
    identity,
  ).eq('status', 'active').select('id');
  return (data || []).length;
};

/** "START": turns back on links this WhatsApp had stopped. Returns how many. */
const optIn = async (identity) => {
  if (!hasIdentity(identity)) return 0;
  const now = new Date().toISOString();
  const { data } = await identityFilter(
    supabaseAdmin.from('whatsapp_links').update({
      status: 'active', opted_out_at: null, consented_at: now, consent_version: CONSENT_VERSION, consent_source: 'whatsapp_start', updated_at: now,
    }),
    identity,
  ).eq('status', 'opted_out').select('id');
  return (data || []).length;
};

/** "Stop these updates" on a marketing message: news and celebrations off. */
const stopMarketing = async (identity) => {
  if (!hasIdentity(identity)) return 0;
  const { data: links } = await identityFilter(
    supabaseAdmin.from('whatsapp_links').select('id, groups'),
    identity,
  );
  const off = Object.fromEntries(MARKETING_GROUPS.map((key) => [key, false]));
  for (const link of links || []) {
    // eslint-disable-next-line no-await-in-loop
    await supabaseAdmin
      .from('whatsapp_links')
      .update({ groups: { ...(link.groups || {}), ...off }, updated_at: new Date().toISOString() })
      .eq('id', link.id);
  }
  return (links || []).length;
};

/** Meta's "user changed number" notice: keep their links on the new number. */
const changeNumber = async ({ oldPhone, newPhone, previousBsuid, newBsuid }) => {
  const before = normalizeIdentity({ phone: oldPhone, bsuid: previousBsuid });
  const after = normalizeIdentity({ phone: newPhone, bsuid: newBsuid });
  const updates = { updated_at: new Date().toISOString() };
  if (after.phone) updates.phone = after.phone;
  if (after.bsuid) updates.bsuid = after.bsuid;
  if (!after.phone && !after.bsuid) return;
  if (before.phone) await supabaseAdmin.from('whatsapp_links').update(updates).eq('phone', before.phone);
  if (before.bsuid) await supabaseAdmin.from('whatsapp_links').update(updates).eq('bsuid', before.bsuid);
};

const getLink = async (subjectType, subjectId) => {
  const { data } = await supabaseAdmin
    .from('whatsapp_links')
    .select('id, phone, bsuid, status, groups, consented_at, opted_out_at, created_at')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .maybeSingle();
  return data || null;
};

/** What the person's own WhatsApp card shows. Never the full number. */
const describeLink = (link, role) => ({
  connected: Boolean(link && link.status === 'active'),
  status: link ? link.status : 'not_connected',
  number: link?.phone ? maskPhone(link.phone) : (link ? 'WhatsApp username' : null),
  connectedAt: link?.consented_at || null,
  stoppedAt: link?.opted_out_at || null,
  groups: describeGroups(groupsForRole(role), link?.groups || {}),
});

const updateGroups = async (subjectType, subjectId, role, groups) => {
  const link = await getLink(subjectType, subjectId);
  if (!link) throw new BadRequestError('Connect your WhatsApp first.');
  const next = { ...(link.groups || {}), ...sanitizeGroups(groups, groupsForRole(role)) };
  const { error } = await supabaseAdmin
    .from('whatsapp_links')
    .update({ groups: next, updated_at: new Date().toISOString() })
    .eq('id', link.id);
  if (error) throw new BadRequestError(error.message);
  return describeLink({ ...link, groups: next }, role);
};

/** Disconnect: the link is removed; connecting again needs a new JOIN. */
const disconnect = async (subjectType, subjectId) => {
  await supabaseAdmin.from('whatsapp_links').delete().eq('subject_type', subjectType).eq('subject_id', subjectId);
  await supabaseAdmin
    .from('whatsapp_link_codes')
    .update({ expires_at: new Date().toISOString() })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .is('used_at', null);
};

/** After "account deactivated": nothing more goes to that person. */
const closeLink = async (subjectType, subjectId) => {
  await supabaseAdmin
    .from('whatsapp_links')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId);
};

// consent_source of a connection SpaxSync made from the number HR entered.
const HR_ADDED = 'hr_added';
// The first message (owner's wording, 2 Nov 2026): a welcome for someone HR
// has just added; an announcement for people who already work there.
const FIRST_MESSAGE = { new: 'welcome_new_employee', existing: 'hr_updates_on_whatsapp' };
// One "Connect everyone" press reaches at most this many people: until the
// business is verified, Meta allows about 250 different people a day.
const CONNECT_AT_ONCE = 200;

/** A mobile as the employee forms take it ("9876543210", "+91 98765 43210") → "919876543210"; anything else null. */
const indianMobile = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `91${local}` : null;
};

/** Is WhatsApp on for this company: the paid add-on, and the company's own switch? */
const companyWhatsappOn = async (companyId) => Boolean(companyId)
  && (await settings.isAddOnEnabled(companyId))
  && (await settings.getCompanySettings(companyId)).enabled;

const hrAddedLink = (employeeId, companyId, phone, now) => ({
  subject_type: 'employee',
  subject_id: employeeId,
  company_id: companyId,
  phone,
  status: 'active',
  consent_version: CONSENT_VERSION,
  consented_at: now,
  consent_source: HR_ADDED,
  updated_at: now,
});

/** The first message for people SpaxSync just connected: kind 'new' or 'existing'. */
const queueFirstMessage = ({ employeeIds, kind, source, recordKey }) => {
  // Required here: the outbox needs this module (through the approvals service).
  const outbox = require('./whatsappOutbox.service');
  return outbox.queueEvent({
    eventKey: 'whatsapp_connected',
    source,
    recordKey,
    template: FIRST_MESSAGE[kind],
    group: 'account',
    recipients: employeeIds.map((subjectId) => ({ subjectType: 'employee', subjectId })),
    params: async ({ person, company }) => [firstName(person), await companyName(company)],
  });
};

/**
 * HR saved a new employee: their WhatsApp is connected to the mobile number
 * straight away and the welcome is queued — or, for a bulk import (usually
 * people who already work there), the existing-employee message. Only where
 * WhatsApp can send (never a PC with it switched off), only for a company
 * with WhatsApp on, and never over an existing connection.
 */
const connectAddedEmployee = async ({ employeeId, phone: rawPhone, companyId, existingStaff = false }) => {
  const cfg = getConfig();
  const phone = indianMobile(rawPhone);
  if (!canSend(cfg) || !employeeId || !phone || !isRecipientAllowed(phone, cfg)) return false;
  if (!(await companyWhatsappOn(companyId))) return false;

  const { data, error } = await supabaseAdmin
    .from('whatsapp_links')
    .upsert(hrAddedLink(employeeId, companyId, phone, new Date().toISOString()), { onConflict: 'subject_type,subject_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new BadRequestError(error.message);
  if (!data?.length) return false;
  await queueFirstMessage({
    employeeIds: [employeeId], kind: existingStaff ? 'existing' : 'new', source: 'employee:created', recordKey: phone,
  });
  return true;
};

/**
 * The employee's mobile number was saved (HR's edit, their own one-time
 * edit, first sign-in, or onboarding): a connection SpaxSync made moves to a
 * new number, which gets the first message, or stops if the number was
 * cleared. Its BSUID belonged to the old number's WhatsApp, so it goes. A
 * connection the person made or stopped themselves is left alone.
 */
const followNumberChange = async ({ employeeId, phone: rawPhone }) => {
  if (!canSend(getConfig()) || !employeeId) return false;
  const phone = indianMobile(rawPhone);
  if (!phone) {
    // The number was cleared, or isn't a mobile any more: a connection
    // SpaxSync made from the old one stops — that number isn't theirs now.
    const { error: dropError } = await supabaseAdmin
      .from('whatsapp_links')
      .delete()
      .eq('subject_type', 'employee')
      .eq('subject_id', employeeId)
      .eq('status', 'active')
      .eq('consent_source', HR_ADDED);
    if (dropError) throw new BadRequestError(dropError.message);
    return false;
  }
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_links')
    .update({ phone, bsuid: null, consented_at: now, updated_at: now })
    .eq('subject_type', 'employee')
    .eq('subject_id', employeeId)
    .eq('status', 'active')
    .eq('consent_source', HR_ADDED)
    .neq('phone', phone)
    .select('id');
  if (error) throw new BadRequestError(error.message);
  if (!data?.length) return false;
  await queueFirstMessage({ employeeIds: [employeeId], kind: 'existing', source: 'employee:number_changed', recordKey: phone });
  return true;
};

/** Runs a `.in(column, ids)` query in slices, so a big company never makes one huge request. */
const inSlices = async (ids, run, size = 150) => {
  const rows = [];
  for (let i = 0; i < ids.length; i += size) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await run(ids.slice(i, i + size));
    if (error) throw new BadRequestError(error.message);
    rows.push(...(data || []));
  }
  return rows;
};

/**
 * Who "Connect everyone" would reach in a company: active employees with a
 * usable mobile number and no WhatsApp connection. Left out: people already
 * connected; people who were connected before and stopped or disconnected
 * (a used JOIN code or an earlier first message shows it — their choice
 * stands); and people without a usable number.
 */
const connectCandidates = async (companyId) => {
  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id, phone')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (error) throw new BadRequestError(error.message);
  const ids = (employees || []).map((e) => e.id);
  const [links, codes, firsts] = await Promise.all([
    inSlices(ids, (slice) => supabaseAdmin.from('whatsapp_links').select('subject_id, status')
      .eq('subject_type', 'employee').in('subject_id', slice)),
    inSlices(ids, (slice) => supabaseAdmin.from('whatsapp_link_codes').select('subject_id, used_at')
      .eq('subject_type', 'employee').in('subject_id', slice)),
    inSlices(ids, (slice) => supabaseAdmin.from('whatsapp_messages').select('subject_id')
      .eq('subject_type', 'employee').eq('event_key', 'whatsapp_connected').in('subject_id', slice)),
  ]);
  const linkStatus = new Map(links.map((l) => [l.subject_id, l.status]));
  const connectedBefore = new Set([...codes.filter((c) => c.used_at).map((c) => c.subject_id), ...firsts.map((m) => m.subject_id)]);

  const result = { employees: ids.length, connected: 0, leftAlone: 0, noMobile: 0, ready: [] };
  for (const employee of employees || []) {
    const phone = indianMobile(employee.phone);
    if (linkStatus.get(employee.id) === 'active') result.connected += 1;
    else if (linkStatus.has(employee.id) || connectedBefore.has(employee.id)) result.leftAlone += 1;
    else if (!phone) result.noMobile += 1;
    else result.ready.push({ employeeId: employee.id, phone });
  }
  return result;
};

/**
 * Super Admin → WhatsApp → Connect employees: connects a company's existing
 * employees to the mobile numbers HR has on file, and queues the
 * existing-employee message. Nothing reaches them until a super admin
 * presses it (owner's decision, 2 Nov 2026), and only once Meta has approved
 * that message, so it always arrives before any other update.
 */
const connectExistingEmployees = async (companyId) => {
  const cfg = getConfig();
  if (!canSend(cfg)) throw new BadRequestError('WhatsApp is switched off on this server.');
  if (!(await companyWhatsappOn(companyId))) {
    throw new BadRequestError('WhatsApp is off for this company: the add-on or the company\'s own switch is off.');
  }
  // Required here: the approvals service needs this module.
  const approvals = require('./whatsappApprovals.service');
  if (!(await approvals.isApprovedAtMeta(FIRST_MESSAGE.existing, { fresh: true }))) {
    throw new BadRequestError(`Meta has not approved the message yet (${FIRST_MESSAGE.existing}). Submit it in the Templates tab and wait until it shows approved.`);
  }

  const { ready } = await connectCandidates(companyId);
  const reachable = ready.filter((c) => isRecipientAllowed(c.phone, cfg));
  const batch = reachable.slice(0, CONNECT_AT_ONCE);
  if (!batch.length) return { connected: 0, remaining: 0 };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_links')
    .upsert(batch.map((c) => hrAddedLink(c.employeeId, companyId, c.phone, now)), { onConflict: 'subject_type,subject_id', ignoreDuplicates: true })
    .select('subject_id');
  if (error) throw new BadRequestError(error.message);
  const linked = (data || []).map((l) => l.subject_id);
  if (linked.length) {
    await queueFirstMessage({ employeeIds: linked, kind: 'existing', source: 'super_admin:connect_everyone', recordKey: 'connect_everyone' });
  }
  return { connected: linked.length, remaining: reachable.length - batch.length };
};

module.exports = {
  CONSENT_VERSION,
  CODE_ALPHABET,
  CODE_LENGTH,
  hashCode,
  newCode,
  normalizeIdentity,
  consentText,
  startLink,
  completeLink,
  optOut,
  optIn,
  stopMarketing,
  changeNumber,
  getLink,
  describeLink,
  updateGroups,
  disconnect,
  closeLink,
  HR_ADDED,
  FIRST_MESSAGE,
  CONNECT_AT_ONCE,
  indianMobile,
  connectAddedEmployee,
  followNumberChange,
  connectCandidates,
  connectExistingEmployees,
};
