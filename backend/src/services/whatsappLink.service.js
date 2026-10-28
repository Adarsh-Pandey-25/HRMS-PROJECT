const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getConfig } = require('../config/whatsapp');
const { BadRequestError, TooManyRequestsError } = require('../utils/errors');
const { MARKETING_GROUPS, groupsForRole, sanitizeGroups, describeGroups } = require('./whatsappGroups');
const { maskPhone } = require('./whatsappFormat');

/**
 * Connecting a person's WhatsApp. Only the person can do it: SpaxSync shows a
 * one-time code and a wa.me link with "JOIN <code>" typed in; they press
 * Send in WhatsApp, and the webhook links the number Meta reports for that
 * message to their account. That single tap proves the number is theirs,
 * records their agreement (Meta requires opt-in naming the business) and
 * costs nothing.
 *
 * Codes are random, single-use, valid 15 minutes, and only their SHA-256 is
 * stored.
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
};
