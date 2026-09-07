const crypto = require('crypto');
const dns = require('dns').promises;
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { anyIpInCidr } = require('../utils/helpers');
const { encryptWebhookSecret, decryptWebhookSecret } = require('../utils/webhookCrypto');
const { WEBHOOK_EVENTS, WEBHOOK_EVENT_KEYS } = require('../config/webhookEvents');

const DELIVERY_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2000, 4000]; // between attempt 1->2 and 2->3 — exponential backoff
const RESPONSE_BODY_TRUNCATE = 2000;

// SSRF blocklist: loopback, RFC1918 private ranges, link-local (this also
// covers the 169.254.169.254 cloud-metadata endpoint — the classic SSRF
// target — since it falls inside 169.254.0.0/16), and their IPv6
// equivalents. Checked against the RESOLVED IP, not just the hostname
// string, so a hostname that only resolves to a private address at request
// time (DNS rebinding) is still caught.
const BLOCKED_RANGES = '127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,0.0.0.0/8,::1/128,fc00::/7,fe80::/10';

/**
 * Item 5: validates a webhook URL is well-formed, https, and does not
 * resolve to a private/loopback/link-local address — a company using this
 * feature to point at their own internal infrastructure (or cloud metadata
 * endpoints) is exactly the SSRF risk outbound webhooks create. Runs once
 * at creation/update time; dispatch trusts the already-validated URL
 * rather than re-resolving DNS on every delivery (a hostname that
 * legitimately changes IP between validation and delivery is an accepted
 * tradeoff — the alternative, re-validating on every send, adds a DNS
 * round trip to every delivery for a narrow rebinding window).
 */
const assertSafeWebhookUrl = async (rawUrl) => {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new BadRequestError('Webhook URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestError('Webhook URL must use https://');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    throw new BadRequestError('Webhook URL may not point at localhost');
  }

  let addresses;
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch (err) {
    throw new BadRequestError(`Could not resolve webhook URL host: ${err.message}`);
  }
  if (!addresses.length) throw new BadRequestError('Webhook URL host does not resolve to any address');
  if (addresses.some((ip) => anyIpInCidr([ip], BLOCKED_RANGES))) {
    throw new BadRequestError('Webhook URL resolves to a private/internal address and cannot be used');
  }
  return parsed.toString();
};

// ── CRUD ─────────────────────────────────────────────────────────────────

const sanitizeEvents = (events) => {
  const clean = Array.isArray(events) ? events.filter((e) => WEBHOOK_EVENT_KEYS.includes(e)) : [];
  if (!clean.length) throw new BadRequestError('Select at least one event to subscribe to');
  return clean;
};

const toPublic = (row) => ({
  id: row.id,
  url: row.url,
  subscribedEvents: row.subscribed_events || [],
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const listWebhooks = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return (data || []).map(toPublic);
};

const createWebhook = async (companyId, { url, subscribedEvents }, createdBy) => {
  const safeUrl = await assertSafeWebhookUrl(url);
  const events = sanitizeEvents(subscribedEvents);
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

  const { data, error } = await supabaseAdmin
    .from('webhooks')
    .insert({
      company_id: companyId,
      url: safeUrl,
      secret_hash: encryptWebhookSecret(secret),
      subscribed_events: events,
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);

  return { ...toPublic(data), secret }; // secret shown once, never again
};

const getOwnedWebhookOrThrow = async (companyId, id) => {
  const { data, error } = await supabaseAdmin.from('webhooks').select('*').eq('id', id).eq('company_id', companyId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Webhook not found');
  return data;
};

const updateWebhook = async (companyId, id, { url, subscribedEvents, isActive }) => {
  await getOwnedWebhookOrThrow(companyId, id);
  const patch = { updated_at: new Date().toISOString() };
  if (url !== undefined) patch.url = await assertSafeWebhookUrl(url);
  if (subscribedEvents !== undefined) patch.subscribed_events = sanitizeEvents(subscribedEvents);
  if (isActive !== undefined) patch.is_active = Boolean(isActive);

  const { data, error } = await supabaseAdmin.from('webhooks').update(patch).eq('id', id).select('*').single();
  if (error) throw new BadRequestError(error.message);
  return toPublic(data);
};

const deleteWebhook = async (companyId, id) => {
  await getOwnedWebhookOrThrow(companyId, id);
  const { error } = await supabaseAdmin.from('webhooks').delete().eq('id', id);
  if (error) throw new BadRequestError(error.message);
  return { deleted: true };
};

const listDeliveries = async (companyId, webhookId, { page = 1, limit = 20 } = {}) => {
  await getOwnedWebhookOrThrow(companyId, webhookId);
  const from = (page - 1) * limit;
  const { data, error, count } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('*', { count: 'exact' })
    .eq('webhook_id', webhookId)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], total: count || 0 };
};

// ── Signing + delivery ──────────────────────────────────────────────────

const signPayload = (secret, bodyString) =>
  `sha256=${crypto.createHmac('sha256', secret).update(bodyString, 'utf8').digest('hex')}`;

/**
 * One HTTP attempt. Never throws — always returns a result object so the
 * caller can log every attempt and decide whether to retry, without a
 * failed delivery ever bubbling up into the action that triggered it.
 */
const attemptDelivery = async (webhookRow, secret, bodyString) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(webhookRow.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signPayload(secret, bodyString),
        'X-Webhook-Id': webhookRow.id,
        'User-Agent': 'HRMS-Webhooks/1.0',
      },
      body: bodyString,
      signal: controller.signal,
      // SSRF fix: fetch's default is redirect:'follow', which would silently
      // chase a 3xx response to whatever internal address it points at —
      // completely bypassing assertSafeWebhookUrl, which only ever validated
      // the ORIGINAL url. 'manual' surfaces the redirect as an opaqueredirect
      // response instead of following it; treated as a failed delivery below.
      redirect: 'manual',
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, status: res.status || null, body: 'Webhook endpoint returned a redirect — redirects are not followed for security reasons.' };
    }
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: text.slice(0, RESPONSE_BODY_TRUNCATE) };
  } catch (err) {
    return { ok: false, status: null, body: String(err.message || err).slice(0, RESPONSE_BODY_TRUNCATE) };
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delivers one event to one webhook with retry/backoff, logging every
 * attempt to webhook_deliveries. Deliberately in-process (setTimeout-based
 * retry, not a durable queue) — this codebase has no job queue
 * infrastructure (Redis/BullMQ) to build on, matching the same honestly-
 * flagged tradeoff as the in-memory rate limiter (System Health already
 * documents that one). A retry in flight is lost if the process restarts
 * — acceptable for a best-effort webhook notification, not acceptable if
 * this were billing-critical, which it isn't.
 */
const deliverToWebhook = async (webhookRow, eventType, payload) => {
  const secret = decryptWebhookSecret(webhookRow.secret_hash);
  const bodyString = JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await attemptDelivery(webhookRow, secret, bodyString);
    const finalAttempt = attempt === MAX_ATTEMPTS;
    const status = result.ok ? 'success' : (finalAttempt ? 'failed' : 'pending');

    await supabaseAdmin.from('webhook_deliveries').insert({
      webhook_id: webhookRow.id,
      event_type: eventType,
      payload,
      response_status: result.status,
      response_body: result.body,
      attempt_number: attempt,
      delivered_at: result.ok ? new Date().toISOString() : null,
      status,
    }).then(({ error }) => {
      if (error) logger.error('[Webhooks] Failed to log delivery attempt', { webhookId: webhookRow.id, error: error.message });
    });

    if (result.ok) return;
    if (finalAttempt) {
      logger.warn('[Webhooks] Delivery permanently failed', { webhookId: webhookRow.id, eventType, attempts: attempt });
      return;
    }
    await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
};

/**
 * Central dispatch — call this from any real backend action. Fire-and-
 * forget by design (never awaited by the caller): looks up active
 * webhooks subscribed to this event for this company and delivers to each
 * independently. A webhook delivery failing (or this lookup itself
 * failing) must never affect the action that triggered it, so every
 * error here is caught and logged, never thrown.
 */
const dispatchWebhookEvent = (companyId, eventType, payload) => {
  if (!WEBHOOK_EVENT_KEYS.includes(eventType)) {
    logger.warn('[Webhooks] Unknown event type dispatched', { eventType });
    return;
  }
  (async () => {
    try {
      const { data: webhooks, error } = await supabaseAdmin
        .from('webhooks')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true);
      if (error) throw new Error(error.message);
      const subscribed = (webhooks || []).filter((w) => (w.subscribed_events || []).includes(eventType));
      await Promise.all(subscribed.map((w) => deliverToWebhook(w, eventType, payload).catch((err) => {
        logger.error('[Webhooks] Delivery threw unexpectedly', { webhookId: w.id, eventType, error: err.message });
      })));
    } catch (err) {
      logger.error('[Webhooks] Dispatch lookup failed', { companyId, eventType, error: err.message });
    }
  })();
};

/** HR/Admin-triggered manual test — single attempt, no retry, result returned synchronously so the UI can show it immediately. */
const sendTestEvent = async (companyId, webhookId) => {
  const webhookRow = await getOwnedWebhookOrThrow(companyId, webhookId);
  const secret = decryptWebhookSecret(webhookRow.secret_hash);
  const payload = { message: 'This is a test event from your HRMS webhook configuration.', triggeredAt: new Date().toISOString() };
  const bodyString = JSON.stringify({ event: 'webhook.test', data: payload, timestamp: new Date().toISOString() });
  const result = await attemptDelivery(webhookRow, secret, bodyString);

  const { error } = await supabaseAdmin.from('webhook_deliveries').insert({
    webhook_id: webhookRow.id,
    event_type: 'webhook.test',
    payload,
    response_status: result.status,
    response_body: result.body,
    attempt_number: 1,
    delivered_at: result.ok ? new Date().toISOString() : null,
    status: result.ok ? 'success' : 'failed',
  });
  if (error) logger.error('[Webhooks] Failed to log test delivery', { webhookId: webhookRow.id, error: error.message });

  return { ok: result.ok, status: result.status, body: result.body };
};

module.exports = {
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, listDeliveries,
  dispatchWebhookEvent, sendTestEvent, assertSafeWebhookUrl,
  WEBHOOK_EVENTS, WEBHOOK_EVENT_KEYS,
  // Exported for direct testability of the signing/delivery mechanics
  // independent of the DB-backed orchestration around them.
  signPayload, attemptDelivery, deliverToWebhook,
};
