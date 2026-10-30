const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getConfig, isRecipientAllowed } = require('../config/whatsapp');
const logger = require('../utils/logger');
const api = require('./whatsappApi');
const settings = require('./whatsappSettings.service');
const linkService = require('./whatsappLink.service');
const approvals = require('./whatsappApprovals.service');
const { STOP_MARKETING_PAYLOAD, STOP_BUTTON_TEXT } = require('./whatsappTemplates');

/**
 * Handles what Meta's webhook delivers (after whatsappWebhook.controller.js
 * has checked its signature):
 *   statuses  sent / delivered / read / failed, plus what Meta charged
 *   messages  JOIN <code>, STOP, START, HELP, the "stop these updates"
 *             button, Approve / Reject on an approval request, Meta's
 *             "changed number" notice — anything else gets one polite
 *             reply a day
 * Message text is never stored or logged; whatsapp_inbound keeps only the
 * message id (Meta retries deliveries) and what we did with it.
 */

const STATUS_RANK = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

const REPLIES = {
  connected: (companyName) => `✅ Connected. You will get HR updates from ${companyName || 'your company'} here.\n\nReply STOP to turn them off, or HELP for help.`,
  connectedAdmin: '✅ Connected. You will get SpaxSync platform alerts here.\n\nReply STOP to turn them off.',
  badCode: 'That code is not valid or has expired. In SpaxSync, open your profile and tap "Connect WhatsApp" again.',
  stopped: 'Done. You will not get SpaxSync updates on WhatsApp any more. Reply START to turn them back on.',
  notConnected: 'This WhatsApp is not connected to SpaxSync. To get updates here, open your profile in SpaxSync and tap "Connect WhatsApp".',
  started: 'Welcome back. SpaxSync updates are on again here. Reply STOP to turn them off.',
  help: 'This number sends SpaxSync HR updates. Reply STOP to stop them, or START to turn them back on. To choose which updates you get, open your profile in SpaxSync.',
  stoppedMarketing: 'Done. You will not get company news or celebration messages here any more. You can turn them back on in your SpaxSync profile.',
  other: 'This number only sends SpaxSync updates and cannot read replies. Please open SpaxSync for anything you need.',
};

const senderHash = ({ phone, bsuid }) => crypto.createHash('sha256').update(String(phone || bsuid || '')).digest('hex');

/** Free-form reply — allowed because the person just messaged us. */
const reply = async (identity, text) => {
  const cfg = getConfig();
  // Same test allow-list as every other send outside production.
  if (!isRecipientAllowed(identity.phone, cfg)) return;
  try {
    await api.sendText({ phone: identity.phone, bsuid: identity.phone ? null : identity.bsuid, text });
  } catch (err) {
    logger.warn('[WhatsApp] reply failed', { code: err.code, error: err.title || err.message });
  }
};

/** Records the message id; false when Meta already delivered it before. */
const firstDelivery = async (message, action, identity) => {
  const { error } = await supabaseAdmin.from('whatsapp_inbound').insert({
    wa_message_id: String(message.id).slice(0, 200),
    received_at: new Date().toISOString(),
    message_type: String(message.type || '').slice(0, 30),
    action,
    sender_hash: senderHash(identity),
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  logger.warn('[WhatsApp] could not record inbound message', { error: error.message });
  return true;
};

/** Answer "other" messages at most once a day per sender. */
const repliedToday = async (identity) => {
  const { count } = await supabaseAdmin
    .from('whatsapp_inbound')
    .select('wa_message_id', { count: 'exact', head: true })
    .eq('sender_hash', senderHash(identity))
    .eq('action', 'other')
    .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  return (count || 0) > 1; // the message just recorded is one of them
};

/** What the person asked for: join (with code), stop, start, help, stop_marketing, approve / reject (with code) or other. */
const classify = (message) => {
  if (message.type === 'button') {
    const payload = String(message.button?.payload || '');
    const text = String(message.button?.text || '');
    if (payload === STOP_MARKETING_PAYLOAD || text === STOP_BUTTON_TEXT) return { action: 'stop_marketing' };
    const tap = approvals.parsePayload(payload);
    if (tap) return { action: tap.decision, code: tap.code };
    return { action: 'other' };
  }
  if (message.type === 'system') return { action: 'system' };
  if (message.type !== 'text') return { action: 'other' };
  const body = String(message.text?.body || '').trim();
  const join = body.match(/^join\s+([A-Za-z0-9]{6,12})\s*$/i);
  if (join) return { action: 'join', code: join[1].toUpperCase() };
  if (/^(stop|stop all|unsubscribe|cancel)\s*$/i.test(body)) return { action: 'stop' };
  if (/^(start|unstop|resume)\s*$/i.test(body)) return { action: 'start' };
  if (/^(help|info)\s*$/i.test(body)) return { action: 'help' };
  return { action: 'other' };
};

/** The sender's number and BSUID; either can be missing since usernames (2026). */
const identityOf = (message, contacts) => {
  const contact = (contacts || []).find((c) => c.user_id === message.from_user_id || c.wa_id === message.from) || contacts?.[0] || {};
  return linkService.normalizeIdentity({
    phone: message.from || contact.wa_id,
    bsuid: message.from_user_id || contact.user_id,
  });
};

const handleMessage = async (message, contacts) => {
  if (!message?.id) return;
  const identity = identityOf(message, contacts);
  const intent = classify(message);
  if (!(await firstDelivery(message, intent.action, identity))) return;

  switch (intent.action) {
    case 'join': {
      const linked = await linkService.completeLink({ code: intent.code, ...identity });
      if (!linked) return reply(identity, REPLIES.badCode);
      return reply(identity, linked.subjectType === 'super_admin' ? REPLIES.connectedAdmin : REPLIES.connected(linked.companyName));
    }
    case 'stop':
      return reply(identity, (await linkService.optOut(identity)) ? REPLIES.stopped : REPLIES.notConnected);
    case 'start':
      return reply(identity, (await linkService.optIn(identity)) ? REPLIES.started : REPLIES.notConnected);
    case 'help':
      return reply(identity, REPLIES.help);
    case 'stop_marketing':
      await linkService.stopMarketing(identity);
      return reply(identity, REPLIES.stoppedMarketing);
    case 'approve':
    case 'reject':
      return reply(identity, await approvals.handleTap({ decision: intent.action, code: intent.code, identity }));
    case 'system': {
      const system = message.system || {};
      if (system.type === 'user_changed_number' || system.type === 'user_changed_user_id') {
        await linkService.changeNumber({
          oldPhone: message.from,
          newPhone: system.new_wa_id || system.wa_id,
          previousBsuid: system.previous_user_id,
          newBsuid: system.user_id || message.from_user_id,
        });
      }
      return null;
    }
    default:
      if (await repliedToday(identity)) return null;
      return reply(identity, REPLIES.other);
  }
};

/** Moves a message forward (sent → delivered → read), never backwards; failures always recorded. */
const handleStatus = async (status) => {
  const waMessageId = status?.id;
  if (!waMessageId) return;
  const { data: row } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('id, status')
    .eq('wa_message_id', waMessageId)
    .maybeSingle();
  if (!row) return; // not ours (e.g. a reply sent with sendText)

  const fields = { updated_at: new Date().toISOString() };
  if (status.pricing) {
    fields.pricing_category = String(status.pricing.category || '').slice(0, 30) || null;
    if (typeof status.pricing.billable === 'boolean') fields.billable = status.pricing.billable;
  }
  if (status.status === 'failed') {
    const error = status.errors?.[0] || {};
    fields.status = 'failed';
    fields.error_code = error.code !== undefined ? String(error.code) : null;
    fields.error_title = String(error.error_data?.details || error.title || error.message || 'Delivery failed').slice(0, 300);
  } else if (STATUS_RANK[status.status] !== undefined && STATUS_RANK[status.status] > (STATUS_RANK[row.status] ?? -1)) {
    fields.status = status.status;
  }
  await supabaseAdmin.from('whatsapp_messages').update(fields).eq('id', row.id);
};

/** Meta's "user_preferences" event: the person stopped marketing in WhatsApp's own settings. */
const handleUserPreferences = async (value) => {
  for (const pref of value?.user_preferences || []) {
    if (pref.category === 'marketing_messages' && pref.value === 'stop') {
      // eslint-disable-next-line no-await-in-loop
      await linkService.stopMarketing(linkService.normalizeIdentity({ phone: pref.wa_id, bsuid: pref.user_id }));
    }
  }
};

/** Everything in one webhook delivery, for our phone number only. */
const processWebhook = async (payload) => {
  const cfg = getConfig();
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      // Another number on the same Meta app (e.g. the live number while this
      // is a developer's machine): not ours to handle.
      if (phoneNumberId && cfg.phoneNumberId && String(phoneNumberId) !== cfg.phoneNumberId) continue;
      if (change.field === 'messages') {
        for (const status of value.statuses || []) {
          // eslint-disable-next-line no-await-in-loop
          await handleStatus(status);
        }
        for (const message of value.messages || []) {
          // eslint-disable-next-line no-await-in-loop
          await handleMessage(message, value.contacts);
        }
      } else if (change.field === 'user_preferences') {
        // eslint-disable-next-line no-await-in-loop
        await handleUserPreferences(value);
      }
    }
  }
  await settings.touchWebhook(cfg.environment).catch(() => {});
};

module.exports = { processWebhook, classify, identityOf, handleStatus, handleMessage, REPLIES, STATUS_RANK };
