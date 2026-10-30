const { supabaseAdmin } = require('../config/supabase');
const { getConfig, canSend, isRecipientAllowed } = require('../config/whatsapp');
const logger = require('../utils/logger');
const { forEachWithLimit } = require('../utils/concurrency');
const api = require('./whatsappApi');
const settings = require('./whatsappSettings.service');
const linkService = require('./whatsappLink.service');
const approvals = require('./whatsappApprovals.service');
const { getTemplate, isMarketing, LANGUAGE, STOP_MARKETING_PAYLOAD } = require('./whatsappTemplates');
const { isGroupOn } = require('./whatsappGroups');

/**
 * Sends queued WhatsApp messages. Runs only when WHATSAPP_ENABLED=true —
 * independent of DISABLE_CRONS, so a developer can test sending while the
 * scheduled jobs stay off.
 *
 * Each tick claims a few due rows for THIS environment only
 * (whatsapp_claim_outbox): production and a developer's machine share the
 * database but never send each other's messages, and two workers never send
 * one row twice. Before sending, the person's link is checked again — a
 * STOP that arrived after queueing still wins.
 */

const POLL_MS = 3000;
const BATCH_SIZE = 20;
const PARALLEL_SENDS = 5;
const MAX_ATTEMPTS = 5;
// Wait before attempt 2, 3, 4, 5 after a "try again later" answer.
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
// A row still 'sending' this long after it was claimed belongs to a crashed
// worker. It is marked failed, never resent: Meta may have delivered it.
const STUCK_AFTER_MS = 15 * 60 * 1000;
const PAUSED_RECHECK_MS = 5 * 60 * 1000;

let timer = null;
let busy = false;
let lastStuckSweep = 0;

const update = (id, fields) => supabaseAdmin
  .from('whatsapp_messages')
  .update({ ...fields, updated_at: new Date().toISOString() })
  .eq('id', id);

// A template's private values (an approval request's reason) leave the
// message log as soon as the row is done with.
const doneFields = (row) => {
  const template = getTemplate(row.template);
  return template?.privateParams ? { params: approvals.redactParams(template, row.params) } : {};
};

const markSkipped = (row, reason) => update(row.id, { status: 'skipped', skip_reason: reason, ...doneFields(row) });

const failStuckRows = async (environment) => {
  if (Date.now() - lastStuckSweep < 60 * 1000) return;
  lastStuckSweep = Date.now();
  await supabaseAdmin
    .from('whatsapp_messages')
    .update({ status: 'failed', error_title: 'Sending was interrupted', updated_at: new Date().toISOString() })
    .eq('environment', environment)
    .eq('status', 'sending')
    .lt('claimed_at', new Date(Date.now() - STUCK_AFTER_MS).toISOString());
};

/** Is the person still connected, with this message's group on? */
const stillWanted = async (row) => {
  const { data: link } = await supabaseAdmin
    .from('whatsapp_links')
    .select('status, groups, phone, bsuid')
    .eq('subject_type', row.subject_type)
    .eq('subject_id', row.subject_id)
    .maybeSingle();
  if (!link || link.status !== 'active') return { ok: false, reason: 'not_connected' };
  if (row.message_group !== 'account' && !isGroupOn(link.groups, row.message_group)) {
    return { ok: false, reason: 'group_off' };
  }
  return { ok: true, link };
};

const handleSendError = async (row, err, environment) => {
  const code = err.code !== null && err.code !== undefined ? String(err.code) : null;
  const errorFields = { error_code: code, error_title: String(err.title || err.message).slice(0, 300) };

  if (err.pauseSending) {
    // The account, token or number is the problem — every send would fail.
    await settings.setPaused(environment, true, {
      reason: `Meta refused sending${code ? ` (error ${code})` : ''}: ${errorFields.error_title}`,
      by: 'system',
    });
    logger.error('[WhatsApp] sending paused — fix the Meta account or token, then resume in Super Admin → WhatsApp', errorFields);
    await update(row.id, { status: 'queued', next_attempt_at: new Date(Date.now() + PAUSED_RECHECK_MS).toISOString(), ...errorFields });
    return;
  }
  if (err.retryable && row.attempts < MAX_ATTEMPTS) {
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)];
    await update(row.id, { status: 'queued', next_attempt_at: new Date(Date.now() + delay).toISOString(), ...errorFields });
    return;
  }
  // 131050: they told WhatsApp to stop marketing from us — respect it here too.
  if (code === '131050') {
    await linkService.stopMarketing(row.recipient_kind === 'phone' ? { phone: row.recipient } : { bsuid: row.recipient });
  }
  await update(row.id, { status: 'failed', ...errorFields, ...doneFields(row) });
};

const sendRow = async (row, cfg) => {
  const template = getTemplate(row.template);
  if (!template) return markSkipped(row, 'unknown_template');
  const wanted = await stillWanted(row);
  if (!wanted.ok) return markSkipped(row, wanted.reason);
  const phone = row.recipient_kind === 'phone' ? row.recipient : null;
  if (!isRecipientAllowed(phone, cfg)) return markSkipped(row, 'not_on_test_allow_list');

  try {
    // Approval requests go with fresh Approve / Reject codes, or as the plain
    // fallback until Meta approves them (whatsappApprovals.service.js).
    const send = template.buttons
      ? await approvals.prepareSend(row, template)
      : { template: template.name, params: Array.isArray(row.params) ? row.params : [], buttonPayloads: null };
    const { waMessageId } = await api.sendTemplate({
      phone,
      bsuid: row.recipient_kind === 'bsuid' ? row.recipient : null,
      template: send.template,
      language: LANGUAGE,
      params: send.params,
      quickReplyPayload: isMarketing(template) ? STOP_MARKETING_PAYLOAD : null,
      buttonPayloads: send.buttonPayloads,
    });
    const sentAs = getTemplate(send.template);
    await update(row.id, {
      status: 'sent', wa_message_id: waMessageId, sent_at: new Date().toISOString(), error_code: null, error_title: null,
      // The log shows what actually went, private values hidden.
      ...(sentAs !== template || template.privateParams
        ? { template: sentAs.name, params: approvals.redactParams(sentAs, send.params) }
        : {}),
    });
    // "Your account was deactivated" is the last message that person gets.
    if (row.event_key === 'account_deactivated') await linkService.closeLink(row.subject_type, row.subject_id);
  } catch (err) {
    await handleSendError(row, err, cfg.environment);
  }
  return null;
};

const tick = async () => {
  if (busy) return;
  busy = true;
  try {
    const cfg = getConfig();
    if (!canSend(cfg)) return;
    if ((await settings.getPlatformState(cfg.environment)).paused) return;
    await failStuckRows(cfg.environment);
    const { data: rows, error } = await supabaseAdmin.rpc('whatsapp_claim_outbox', {
      p_environment: cfg.environment,
      p_limit: BATCH_SIZE,
    });
    if (error) {
      logger.warn('[WhatsApp] could not read the outbox — has 20261028_whatsapp_channel.sql been run?', { error: error.message });
      return;
    }
    if (!rows?.length) return;
    await forEachWithLimit(rows, PARALLEL_SENDS, (row) => sendRow(row, cfg), (err, row) => {
      logger.warn('[WhatsApp] send failed unexpectedly', { id: row?.id, error: err?.message });
    });
  } catch (err) {
    logger.warn('[WhatsApp] worker tick failed', { error: err?.message });
  } finally {
    busy = false;
  }
};

/** Started from server.js. Does nothing unless WhatsApp is switched on. */
const start = () => {
  if (timer) return;
  const cfg = getConfig();
  if (!cfg.enabled) return;
  if (!canSend(cfg)) {
    logger.warn('[WhatsApp] WHATSAPP_ENABLED is true but WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing — nothing will be sent');
    return;
  }
  timer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`[WhatsApp] sender started (${cfg.environment}${cfg.production ? '' : `, test numbers only: ${cfg.allowedRecipients.size}`})`);
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { start, stop, tick, sendRow, handleSendError, MAX_ATTEMPTS, RETRY_DELAYS_MS };
