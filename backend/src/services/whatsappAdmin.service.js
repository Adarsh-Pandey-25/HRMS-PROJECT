const { supabaseAdmin } = require('../config/supabase');
const { getConfig, missingSettings, canSend, isRecipientAllowed, digitsOnly } = require('../config/whatsapp');
const { BadRequestError } = require('../utils/errors');
const api = require('./whatsappApi');
const settings = require('./whatsappSettings.service');
const { TEMPLATES, LANGUAGE, toCreatePayload, templateProblems } = require('./whatsappTemplates');
const { maskPhone } = require('./whatsappFormat');

/**
 * The super-admin WhatsApp console: setup status, account health, the
 * message log, an estimated bill, the pause switch, and template
 * submission. Numbers are always masked; message text is never stored, so
 * the log shows the template and its short values only.
 */

/**
 * Meta's India list prices per delivered message (rate card effective
 * 1 Jul 2026, checked 28 Oct 2026), before GST. An estimate only — Meta's
 * invoice is the real bill. Service replies: first 1,000 a month per number
 * are free, so they are not counted here.
 */
const RATES_INR = { asOf: '2026-07-01', utility: 0.115, marketing: 0.8631, authentication: 0.115 };

const DAYS_IN_OVERVIEW = 30;

const configSummary = (cfg = getConfig()) => ({
  enabled: cfg.enabled,
  environment: cfg.environment,
  production: cfg.production,
  apiVersion: cfg.apiVersion,
  phoneNumberId: cfg.phoneNumberId || null,
  wabaId: cfg.wabaId || null,
  businessNumber: cfg.businessNumber ? `+${cfg.businessNumber}` : null,
  testRecipients: cfg.production ? null : [...cfg.allowedRecipients].map(maskPhone),
  missing: missingSettings(cfg),
});

const overview = async () => {
  const cfg = getConfig();
  const since = new Date(Date.now() - DAYS_IN_OVERVIEW * 24 * 60 * 60 * 1000).toISOString();

  const [state, rowsResult, links] = await Promise.all([
    settings.getPlatformState(cfg.environment, { fresh: true }),
    supabaseAdmin
      .from('whatsapp_messages')
      .select('status, category, pricing_category, billable, company_id')
      .gte('created_at', since)
      .limit(20000),
    supabaseAdmin.from('whatsapp_links').select('subject_type, status'),
  ]);
  if (rowsResult.error) throw new BadRequestError(`${rowsResult.error.message} — has 20261028_whatsapp_channel.sql been run?`);

  const rows = rowsResult.data || [];
  const byStatus = {};
  const byCompany = new Map();
  let utility = 0;
  let marketing = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    const delivered = ['sent', 'delivered', 'read'].includes(row.status);
    // Meta's own pricing answer when we have it; otherwise our template category.
    const charged = row.billable === false ? null : (row.pricing_category || (delivered ? row.category : null));
    if (charged === 'marketing') marketing += 1;
    else if (charged === 'utility' || charged === 'authentication') utility += 1;
    if (row.company_id) {
      const c = byCompany.get(row.company_id) || { companyId: row.company_id, total: 0, delivered: 0, failed: 0, cost: 0 };
      c.total += 1;
      if (delivered) c.delivered += 1;
      if (row.status === 'failed') c.failed += 1;
      if (charged === 'marketing') c.cost += RATES_INR.marketing;
      else if (charged === 'utility' || charged === 'authentication') c.cost += RATES_INR.utility;
      byCompany.set(row.company_id, c);
    }
  }

  const companyIds = [...byCompany.keys()];
  const { data: companies } = companyIds.length
    ? await supabaseAdmin.from('companies').select('id, name').in('id', companyIds)
    : { data: [] };
  const nameOf = new Map((companies || []).map((c) => [c.id, c.name]));

  let health = null;
  if (canSend(cfg)) {
    try {
      const h = await api.getPhoneNumberHealth();
      health = {
        displayNumber: h.display_phone_number || null,
        verifiedName: h.verified_name || null,
        qualityRating: h.quality_rating || null,
        nameStatus: h.name_status || null,
        verificationStatus: h.code_verification_status || null,
        throughput: h.throughput?.level || null,
      };
    } catch (err) {
      health = { error: err.title || err.message };
    }
  }

  return {
    config: configSummary(cfg),
    state,
    health,
    connected: {
      employees: (links.data || []).filter((l) => l.subject_type === 'employee' && l.status === 'active').length,
      stopped: (links.data || []).filter((l) => l.status === 'opted_out').length,
      superAdmins: (links.data || []).filter((l) => l.subject_type === 'super_admin' && l.status === 'active').length,
    },
    last30Days: {
      total: rows.length,
      byStatus,
      charged: { utility, marketing },
      estimatedCostInr: Math.round((utility * RATES_INR.utility + marketing * RATES_INR.marketing) * 100) / 100,
      rates: RATES_INR,
      byCompany: [...byCompany.values()]
        .map((c) => ({ ...c, cost: Math.round(c.cost * 100) / 100, companyName: nameOf.get(c.companyId) || 'Unknown company' }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 50),
    },
  };
};

const listMessages = async ({ page = 1, limit = 25, companyId, status, template, from, to } = {}) => {
  const size = Math.min(100, Math.max(1, Number(limit) || 25));
  const current = Math.max(1, Number(page) || 1);
  let query = supabaseAdmin
    .from('whatsapp_messages')
    .select('id, created_at, environment, company_id, subject_type, recipient, recipient_kind, event_key, template, category, message_group, params, status, skip_reason, attempts, error_code, error_title, pricing_category, billable', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((current - 1) * size, current * size - 1);
  if (companyId === 'platform') query = query.is('company_id', null);
  else if (companyId) query = query.eq('company_id', companyId);
  if (status) query = query.eq('status', status);
  if (template) query = query.eq('template', template);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  const { data, error, count } = await query;
  if (error) throw new BadRequestError(error.message);

  const ids = [...new Set((data || []).map((r) => r.company_id).filter(Boolean))];
  const { data: companies } = ids.length
    ? await supabaseAdmin.from('companies').select('id, name').in('id', ids)
    : { data: [] };
  const nameOf = new Map((companies || []).map((c) => [c.id, c.name]));

  return {
    items: (data || []).map((r) => ({
      ...r,
      recipient: r.recipient_kind === 'phone' ? maskPhone(r.recipient) : 'WhatsApp username',
      companyName: r.company_id ? nameOf.get(r.company_id) || 'Unknown company' : 'Platform',
    })),
    total: count || 0,
    page: current,
    limit: size,
  };
};

/** Our templates, each with its status at Meta (when WhatsApp is configured). */
const templatesStatus = async () => {
  const cfg = getConfig();
  let remote = null;
  let remoteError = null;
  if (canSend(cfg) && cfg.wabaId) {
    try {
      remote = await api.listTemplates();
    } catch (err) {
      remoteError = err.title || err.message;
    }
  }
  const remoteByName = new Map((remote || []).filter((t) => t.language === LANGUAGE).map((t) => [t.name, t]));
  return {
    language: LANGUAGE,
    remoteError,
    templates: TEMPLATES.map((t) => {
      const r = remoteByName.get(t.name);
      return {
        name: t.name,
        category: t.category,
        body: t.body,
        problems: templateProblems(t),
        metaStatus: remote ? (r?.status || 'NOT_SUBMITTED') : null,
        metaCategory: r?.category || null,
      };
    }),
  };
};

/** Submits every template Meta does not have yet. Never resubmits existing ones. */
const syncTemplates = async () => {
  const cfg = getConfig();
  if (!canSend(cfg) || !cfg.wabaId) {
    throw new BadRequestError('Set WHATSAPP_ENABLED, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_WABA_ID first.');
  }
  const existing = new Set((await api.listTemplates()).filter((t) => t.language === LANGUAGE).map((t) => t.name));
  const results = [];
  for (const template of TEMPLATES) {
    if (existing.has(template.name)) {
      results.push({ name: template.name, result: 'already_at_meta' });
      continue;
    }
    const problems = templateProblems(template);
    if (problems.length) {
      results.push({ name: template.name, result: 'not_sent', error: problems.join('; ') });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const created = await api.createTemplate(toCreatePayload(template));
      results.push({ name: template.name, result: 'submitted', status: created?.status || null, category: created?.category || null });
    } catch (err) {
      results.push({ name: template.name, result: 'error', error: err.title || err.message });
    }
  }
  return results;
};

/**
 * Meta's ready-made "hello_world" template to one number — the first check
 * that sending works. Outside production only to the test allow-list; in
 * production only to the requesting super admin's own connected WhatsApp.
 */
const sendTestMessage = async ({ to, superAdminId }) => {
  const cfg = getConfig();
  if (!canSend(cfg)) throw new BadRequestError('Set WHATSAPP_ENABLED=true, WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID first.');
  let phone = digitsOnly(to);
  if (cfg.production) {
    const { data: link } = await supabaseAdmin
      .from('whatsapp_links')
      .select('phone, status')
      .eq('subject_type', 'super_admin')
      .eq('subject_id', superAdminId)
      .maybeSingle();
    if (!link?.phone || link.status !== 'active') throw new BadRequestError('Connect your own WhatsApp first — test messages go only to you.');
    phone = link.phone;
  } else if (!isRecipientAllowed(phone, cfg)) {
    throw new BadRequestError('Outside production, test messages only go to numbers in WHATSAPP_ALLOWED_RECIPIENTS.');
  }
  try {
    const { waMessageId } = await api.sendTemplate({ phone, template: 'hello_world', language: 'en_US' });
    return { sent: true, to: maskPhone(phone), waMessageId };
  } catch (err) {
    throw new BadRequestError(`Meta refused the test message: ${err.title || err.message}`);
  }
};

module.exports = {
  RATES_INR,
  configSummary,
  overview,
  listMessages,
  templatesStatus,
  syncTemplates,
  sendTestMessage,
};
