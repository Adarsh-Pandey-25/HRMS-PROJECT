const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getConfig, canSend } = require('../config/whatsapp');
const logger = require('../utils/logger');
const { BadRequestError, TooManyRequestsError } = require('../utils/errors');

/**
 * Confirming that a WhatsApp number is really the approver's (owner's
 * request, 23 Nov 2026).
 *
 * Approve / Reject buttons decide leave, WFH, expenses, attendance
 * corrections and a biometric machine's new IP. A number HR typed in proves
 * nothing: it may be mistyped, recycled, or someone else's (audit #11, #12).
 * So the buttons only go to a WhatsApp the person confirmed themselves:
 *   - JOIN: they connected it from their own SpaxSync login
 *     (consent_source 'whatsapp_join'), or
 *   - a code: SpaxSync sent a 6-digit code to the number on WhatsApp and they
 *     typed it into their profile while signed in ('whatsapp_code').
 * Anyone else gets the approval message without buttons and decides in
 * SpaxSync. When the company's setting is on (Settings → Integrations →
 * WhatsApp; on unless switched off), an approver who isn't confirmed is sent
 * a code automatically the first time an approval goes to them, at most
 * once a day. They can also ask for one from their profile.
 *
 * Codes live in memory (one server process today): 10 minutes, 5 tries, at
 * most 5 a day and one a minute per person; a restart just means asking for
 * a new one. The code is tied to the number it was sent to, so it can't
 * confirm a number HR changed in the meantime. HR changing a code-confirmed
 * number makes it unconfirmed again (whatsappLink.service followNumberChange).
 */

const JOINED = 'whatsapp_join';
const CODE_CONFIRMED = 'whatsapp_code';
const CONFIRMED_SOURCES = new Set([JOINED, CODE_CONFIRMED]);
const SETTING_KEY = 'whatsapp_confirm_approvers_by_code';
const TEMPLATE = 'whatsapp_verify_code';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SENDS_PER_DAY = 5;
const MAX_TRIES = 5;

const codes = new Map(); // employeeId → { hash, recipient, expiresAt, tries }
const sends = new Map(); // employeeId → { times: [ms], lastAutoAt }
const sending = new Set(); // employeeIds with a send under way

const hashOf = (code) => crypto.createHash('sha256').update(String(code)).digest();

/** Does this WhatsApp link get Approve / Reject buttons? */
const isConfirmedLink = (link) => Boolean(link && link.status === 'active' && CONFIRMED_SOURCES.has(link.consent_source));

/** Of these employees, the ones whose WhatsApp is confirmed. Fails closed (nobody) on a database error. */
const confirmedEmployeeIds = async (employeeIds) => {
  const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Set();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_links')
    .select('subject_id, status, consent_source')
    .eq('subject_type', 'employee')
    .in('subject_id', ids);
  if (error) {
    logger.warn('[WhatsApp] Could not check which approvers confirmed their number; nobody gets buttons this time', { error: error.message });
    return new Set();
  }
  return new Set((data || []).filter(isConfirmedLink).map((l) => String(l.subject_id)));
};

/** Is "send a code to approvers who haven't confirmed their number" on for this company? On unless switched off. */
const confirmByCodeOn = async (companyId) => {
  const value = await require('./settings.service').getSetting(SETTING_KEY, null, companyId);
  return value !== false;
};

const setConfirmByCode = async (companyId, on, updatedBy) => {
  const { error } = await require('./settings.service').setSetting(SETTING_KEY, Boolean(on), updatedBy, companyId);
  if (error) {
    logger.error('[WhatsApp] Could not save the confirm-by-code setting', { error: error.message });
    throw new Error('Could not save. Please try again.');
  }
};

/** When this person's code expires, if one is waiting. */
const codeWaitingUntil = (employeeId) => {
  const entry = codes.get(String(employeeId));
  return entry && entry.expiresAt > Date.now() ? new Date(entry.expiresAt).toISOString() : null;
};

/**
 * Sends a 6-digit code to the person's connected WhatsApp. `auto` (before an
 * approval) never throws and stays quiet when a code is waiting, one went in
 * the last day, or anything is off; asked from the profile it explains why
 * not. Returns { sent, expiresAt } or { alreadyConfirmed } or { sent: false }.
 */
const sendCode = async (employeeId, { auto = false } = {}) => {
  const id = String(employeeId || '');
  const refuse = (message, TooMany = false) => {
    if (auto) return { sent: false };
    throw TooMany ? new TooManyRequestsError(message) : new BadRequestError(message);
  };
  if (!id) return refuse('Sign in to confirm your WhatsApp number.');
  if (!canSend(getConfig())) return refuse('WhatsApp is not switched on for SpaxSync yet.');

  const now = Date.now();
  const log = sends.get(id) || { times: [], lastAutoAt: 0 };
  log.times = log.times.filter((t) => now - t < DAY_MS);
  const live = codes.get(id);
  if (auto) {
    if ((live && live.expiresAt > now) || now - log.lastAutoAt < DAY_MS || log.times.length >= MAX_SENDS_PER_DAY) return { sent: false };
  } else {
    const last = log.times.length ? log.times[log.times.length - 1] : 0;
    if (now - last < RESEND_GAP_MS) {
      return refuse(`Please wait ${Math.ceil((RESEND_GAP_MS - (now - last)) / 1000)} seconds before asking for another code.`, true);
    }
    if (log.times.length >= MAX_SENDS_PER_DAY) {
      return refuse('That is 5 codes today. Please try again tomorrow, or connect WhatsApp again with the JOIN message.', true);
    }
  }
  // One send at a time per person, so requests sent together can't each get a code.
  if (sending.has(id)) return refuse('A code is on its way. Please wait a moment.', true);
  sending.add(id);
  try {
    const link = await require('./whatsappLink.service').getLink('employee', id);
    if (!link || link.status !== 'active' || !(link.phone || link.bsuid)) return refuse('Connect your WhatsApp first.');
    if (isConfirmedLink(link)) return { alreadyConfirmed: true };
    if (!(await require('./whatsappApprovals.service').isApprovedAtMeta(TEMPLATE))) {
      return refuse('Codes on WhatsApp are not ready yet (Meta is still approving the message). Please connect with the JOIN message instead.');
    }

    log.times.push(now);
    if (auto) log.lastAutoAt = now;
    sends.set(id, log);
    const code = String(crypto.randomInt(100000, 1000000));
    codes.set(id, { hash: hashOf(code), recipient: link.phone || link.bsuid, expiresAt: now + CODE_TTL_MS, tries: 0 });
    const queued = await require('./whatsappOutbox.service').queueEvent({
      eventKey: 'whatsapp_verify_code',
      source: auto ? 'verify:before_approval' : 'verify:asked',
      recordKey: `${id}:${now}`,
      template: TEMPLATE,
      group: 'account',
      recipients: [{ subjectType: 'employee', subjectId: id }],
      params: async () => [code],
    });
    if (!queued) {
      codes.delete(id);
      return refuse('The code could not be sent on WhatsApp right now. Please try again later.');
    }
    logger.info(`[WhatsApp] Sent a code to confirm the number of employee ${id} (${auto ? 'before an approval' : 'asked from the profile'})`);
    return { sent: true, expiresAt: new Date(now + CODE_TTL_MS).toISOString() };
  } finally {
    sending.delete(id);
  }
};

/**
 * Checks the code the person typed. Right: their WhatsApp link is confirmed
 * for approvals. Each try is counted before comparing; after 5 the code is gone.
 */
const confirmCode = async (employeeId, rawCode) => {
  const id = String(employeeId || '');
  const code = String(rawCode ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw new BadRequestError('Enter the 6-digit code from WhatsApp.');
  const entry = codes.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    codes.delete(id);
    throw new BadRequestError('That code has expired or no code was sent. Ask for a new one.');
  }
  entry.tries += 1;
  if (entry.tries > MAX_TRIES) {
    codes.delete(id);
    throw new TooManyRequestsError('Too many wrong codes. Ask for a new one.');
  }
  if (!crypto.timingSafeEqual(entry.hash, hashOf(code))) {
    const left = MAX_TRIES - entry.tries;
    if (left <= 0) codes.delete(id);
    throw new BadRequestError(left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Ask for a new one.');
  }
  codes.delete(id);

  const link = await require('./whatsappLink.service').getLink('employee', id);
  const changed = () => new BadRequestError('Your WhatsApp number changed after the code was sent. Ask for a new code.');
  if (!link || link.status !== 'active' || (link.phone || link.bsuid) !== entry.recipient) throw changed();
  if (isConfirmedLink(link)) return { confirmed: true };
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_links')
    .update({ consent_source: CODE_CONFIRMED, consented_at: now, updated_at: now })
    .eq('id', link.id)
    .eq('status', 'active')
    .eq(link.phone ? 'phone' : 'bsuid', entry.recipient)
    .select('id');
  if (error) {
    logger.error('[WhatsApp] Could not confirm a number', { employeeId: id, error: error.message });
    throw new Error('Could not confirm the number. Please try again.');
  }
  if (!data || !data.length) throw changed();
  logger.info(`[WhatsApp] Employee ${id} confirmed their WhatsApp number with a code`);
  return { confirmed: true };
};

/**
 * An approval is going to these people without buttons because their number
 * isn't confirmed: when the company's setting is on, each gets a code (at
 * most once a day). Never throws.
 */
const nudgeUnconfirmed = async (companyId, employeeIds) => {
  const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];
  if (!ids.length || !companyId || !canSend(getConfig())) return 0;
  if (!(await confirmByCodeOn(companyId).catch(() => false))) return 0;
  let sent = 0;
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sendCode(id, { auto: true }).catch(() => null);
    if (result?.sent) sent += 1;
  }
  return sent;
};

module.exports = {
  JOINED,
  CODE_CONFIRMED,
  SETTING_KEY,
  isConfirmedLink,
  confirmedEmployeeIds,
  confirmByCodeOn,
  setConfirmByCode,
  codeWaitingUntil,
  sendCode,
  confirmCode,
  nudgeUnconfirmed,
  _resetForTests: () => { codes.clear(); sends.clear(); sending.clear(); },
};
