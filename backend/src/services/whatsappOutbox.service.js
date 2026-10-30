const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getConfig, canSend, isRecipientAllowed } = require('../config/whatsapp');
const logger = require('../utils/logger');
const settings = require('./whatsappSettings.service');
const { isGroupOn } = require('./whatsappGroups');
const { getTemplate, paramCount, isMarketing } = require('./whatsappTemplates');
const { clean } = require('./whatsappFormat');
const approvals = require('./whatsappApprovals.service');

/**
 * Turns "this happened, for these people" into queued WhatsApp messages.
 * Nothing is sent here — whatsappWorker.js sends — so the request or job
 * that triggered it never waits on Meta.
 *
 * A message is queued only when every gate is open:
 *   platform   WHATSAPP_ENABLED with a token, and not paused for this environment
 *   company    the paid add-on is on, the company's own switch is on, the group is on
 *   person     connected (active link), the group is on for them, still active
 *   dev        outside production, the number is on WHATSAPP_ALLOWED_RECIPIENTS
 * and at most one message per event per person is ever queued (dedupe_key).
 */

// The account notice goes even to a just-deactivated person and ignores
// group switches; billing still reaches the admins of an inactive company.
const ALWAYS_GROUPS = new Set(['account']);
const IGNORES_INACTIVE_COMPANY = new Set(['account', 'billing']);

const dedupeKeyFor = (eventKey, recordKey, subjectType, subjectId) => {
  const key = `${eventKey}:${recordKey}:${subjectType}:${subjectId}`;
  return key.length <= 300 ? key : `${eventKey}:${crypto.createHash('sha256').update(key).digest('hex')}`;
};

const loadLinks = async (recipients) => {
  if (recipients === 'super_admins') {
    const { data } = await supabaseAdmin
      .from('whatsapp_links')
      .select('id, subject_type, subject_id, company_id, phone, bsuid, status, groups')
      .eq('subject_type', 'super_admin')
      .eq('status', 'active');
    return data || [];
  }
  const ids = [...new Set((recipients || []).map((r) => r?.subjectId).filter(Boolean))];
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from('whatsapp_links')
    .select('id, subject_type, subject_id, company_id, phone, bsuid, status, groups')
    .eq('subject_type', 'employee')
    .in('subject_id', ids)
    .eq('status', 'active');
  return data || [];
};

const loadPeople = async (links) => {
  const employeeIds = links.filter((l) => l.subject_type === 'employee').map((l) => l.subject_id);
  const adminIds = links.filter((l) => l.subject_type === 'super_admin').map((l) => l.subject_id);
  const people = new Map();
  if (employeeIds.length) {
    const { data } = await supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, role, is_active, company_id')
      .in('id', employeeIds);
    for (const e of data || []) people.set(`employee:${e.id}`, e);
  }
  if (adminIds.length) {
    const { data } = await supabaseAdmin
      .from('super_admins')
      .select('id, name, is_active')
      .in('id', adminIds);
    for (const a of data || []) people.set(`super_admin:${a.id}`, a);
  }
  return people;
};

const loadCompanies = async (companyIds) => {
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin.from('companies').select('id, name, is_active').in('id', ids);
  return new Map((data || []).map((c) => [c.id, c]));
};

const companyAllows = async (companyId, group) => {
  if (!(await settings.isAddOnEnabled(companyId))) return false;
  const companySettings = await settings.getCompanySettings(companyId);
  if (!companySettings.enabled) return false;
  return ALWAYS_GROUPS.has(group) || isGroupOn(companySettings.groups, group);
};

/**
 * @param {object} event
 * @param {string} event.eventKey  what happened, e.g. 'leave_approved'
 * @param {string} event.source    what triggered it, e.g. 'email:leave_approved'
 * @param {string} event.recordKey the record it is about (de-duplication); '' = no de-duplication
 * @param {string} event.template  a name from whatsappTemplates.js
 * @param {string} event.group     a key from whatsappGroups.js
 * @param {Array|string} event.recipients [{ subjectType: 'employee', subjectId }] or 'super_admins'
 * @param {Function} event.params  ({ person, company, link }) => values for {{1}}..{{n}}
 * @param {object} [event.action]  approval requests: { kind, recordId } for the Approve / Reject buttons
 * @returns {Promise<number>} how many messages were queued
 */
const queueEvent = async (event) => {
  const cfg = getConfig();
  if (!canSend(cfg)) return 0;
  const template = getTemplate(event.template);
  if (!template) {
    logger.warn('[WhatsApp] unknown template — nothing queued', { template: event.template, eventKey: event.eventKey });
    return 0;
  }
  if ((await settings.getPlatformState(cfg.environment)).paused) return 0;

  const links = await loadLinks(event.recipients);
  if (!links.length) return 0; // the usual case: nobody involved has connected WhatsApp

  const people = await loadPeople(links);
  const companies = await loadCompanies(links.map((l) => l.company_id));
  const expected = paramCount(template);
  const recordKey = event.recordKey || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const rows = [];

  for (const link of links) {
    const person = people.get(`${link.subject_type}:${link.subject_id}`);
    if (!person) continue;
    const company = link.company_id ? companies.get(link.company_id) || null : null;
    const always = ALWAYS_GROUPS.has(event.group);

    if (link.subject_type === 'employee') {
      if (!company) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!(await companyAllows(company.id, event.group))) continue;
      if (company.is_active === false && !IGNORES_INACTIVE_COMPANY.has(event.group)) continue;
      if (person.is_active === false && !always) continue;
    } else if (person.is_active === false) {
      continue;
    }
    if (!always && !isGroupOn(link.groups, event.group)) continue;
    if (!link.phone && !link.bsuid) continue;
    if (!isRecipientAllowed(link.phone, cfg)) continue;

    let values;
    try {
      // eslint-disable-next-line no-await-in-loop
      values = await event.params({ person, company, link });
    } catch (err) {
      logger.warn('[WhatsApp] could not build message', { eventKey: event.eventKey, error: err.message });
      continue;
    }
    // Rules already keep names and titles short; this is the backstop.
    const params = (values || []).map((v, i) => clean(v, { max: template.paramMax?.[i + 1] || 160 }));
    if (params.length !== expected) {
      logger.warn('[WhatsApp] wrong number of values for template', { template: template.name, expected, got: params.length });
      continue;
    }

    rows.push({
      environment: cfg.environment,
      company_id: link.company_id,
      subject_type: link.subject_type,
      subject_id: link.subject_id,
      recipient: link.phone || link.bsuid,
      recipient_kind: link.phone ? 'phone' : 'bsuid',
      event_key: event.eventKey,
      source: String(event.source || '').slice(0, 80) || null,
      dedupe_key: dedupeKeyFor(event.eventKey, recordKey, link.subject_type, link.subject_id),
      template: template.name,
      category: isMarketing(template) ? 'marketing' : 'utility',
      message_group: event.group,
      params,
      status: 'queued',
    });
  }

  if (!rows.length) return 0;
  // ignoreDuplicates: a second trigger for the same event (e.g. the in-app
  // notification AND the email for one leave approval) is silently dropped.
  const { data, error } = await supabaseAdmin
    .from('whatsapp_messages')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id, subject_type, subject_id, company_id');
  if (error) {
    logger.warn('[WhatsApp] could not queue messages', { eventKey: event.eventKey, error: error.message });
    return 0;
  }
  // Only the rows just queued come back (duplicates are ignored), so each
  // approval message gets exactly one set of buttons.
  if (template.buttons) await approvals.createActions(data || [], event.action);
  return (data || []).length;
};

module.exports = { queueEvent, dedupeKeyFor };
