const { getConfig } = require('../config/whatsapp');

/**
 * The only module that calls Meta's Graph API for WhatsApp. Every request
 * carries the access token in a header and nothing else ever sees it; error
 * messages raised from here never include it.
 */

const GRAPH_BASE = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Meta's WhatsApp error codes (Cloud API error-codes page, checked
 * 28 Oct 2026), grouped by what we do about them.
 *  - RETRY_LATER: Meta says try again (rate limits, temporary outages).
 *  - PAUSE_SENDING: the account, token or number itself is the problem, so
 *    every further send would fail the same way — stop and tell the super
 *    admin rather than burn through the queue.
 *  - everything else fails that one message only.
 */
const RETRY_LATER = new Set([130429, 131000, 131016, 131056, 131057]);
const PAUSE_SENDING = new Set([0, 3, 10, 190, 368, 131005, 131031, 131037, 131042, 131045, 131048, 133010]);

class WhatsAppApiError extends Error {
  constructor(message, {
    status = null, code = null, title = null, retryable = false, pauseSending = false,
  } = {}) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.retryable = retryable;
    this.pauseSending = pauseSending;
  }
}

const toApiError = (httpStatus, body) => {
  const err = body?.error || {};
  const code = Number.isFinite(Number(err.code)) ? Number(err.code) : null;
  const title = String(err.error_data?.details || err.error_user_msg || err.message || `HTTP ${httpStatus}`).slice(0, 300);
  return new WhatsAppApiError(`WhatsApp API error${code !== null ? ` ${code}` : ''}: ${title}`, {
    status: httpStatus,
    code,
    title,
    retryable: (code !== null && RETRY_LATER.has(code)) || httpStatus >= 500 || httpStatus === 429,
    pauseSending: code !== null && PAUSE_SENDING.has(code),
  });
};

const graphRequest = async (method, path, body = null) => {
  const cfg = getConfig();
  if (!cfg.accessToken) {
    throw new WhatsAppApiError('WhatsApp is not configured (WHATSAPP_ACCESS_TOKEN is missing)', { pauseSending: true });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GRAPH_BASE}/${cfg.apiVersion}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new WhatsAppApiError(
      err?.name === 'AbortError' ? 'WhatsApp request timed out' : 'Could not reach WhatsApp',
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw toApiError(res.status, json);
  return json;
};

/**
 * A recipient is a phone number (digits) or, for someone whose number Meta
 * hides behind a WhatsApp username, their BSUID — which goes in its own
 * `recipient` field (Meta, Feb 2026: BSUIDs must use the dedicated field).
 */
const addressFor = ({ phone, bsuid }) => (phone ? { to: phone } : { recipient: bsuid });

/**
 * Sends an approved template. `params` fill the body's {{1}}..{{n}};
 * `quickReplyPayload` (marketing templates) is returned to us when the
 * person taps the template's "stop" button. `buttonPayloads` does the same
 * for a template with several quick replies (Approve / Reject), in order.
 */
const sendTemplate = async ({
  phone, bsuid, template, language = 'en', params = [], quickReplyPayload = null, buttonPayloads = null,
}) => {
  const components = [];
  if (params.length) {
    components.push({
      type: 'body',
      parameters: params.map((text) => ({ type: 'text', text: String(text) })),
    });
  }
  const payloads = buttonPayloads || (quickReplyPayload ? [quickReplyPayload] : []);
  payloads.forEach((payload, index) => {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload }],
    });
  });
  const json = await graphRequest('POST', `${getConfig().phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...addressFor({ phone, bsuid }),
    type: 'template',
    template: { name: template, language: { code: language }, ...(components.length ? { components } : {}) },
  });
  return { waMessageId: json?.messages?.[0]?.id || null };
};

/** Free-form text — only allowed inside the 24-hour window after the person messaged us. */
const sendText = async ({ phone, bsuid, text }) => {
  const json = await graphRequest('POST', `${getConfig().phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...addressFor({ phone, bsuid }),
    type: 'text',
    text: { body: String(text).slice(0, 4096), preview_url: false },
  });
  return { waMessageId: json?.messages?.[0]?.id || null };
};

/** Every template on the WhatsApp Business Account, following Meta's paging. */
const listTemplates = async () => {
  const { wabaId } = getConfig();
  const all = [];
  let after = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ fields: 'name,status,category,language', limit: '100' });
    if (after) query.set('after', after);
    // eslint-disable-next-line no-await-in-loop
    const json = await graphRequest('GET', `${wabaId}/message_templates?${query}`);
    all.push(...(json?.data || []));
    after = json?.paging?.next ? json?.paging?.cursors?.after : null;
    if (!after) break;
  }
  return all;
};

/** Submits one template for Meta's review. */
const createTemplate = async (payload) => graphRequest('POST', `${getConfig().wabaId}/message_templates`, payload);

/** Name, quality and status of the business number, for the super-admin page. */
const getPhoneNumberHealth = async () => graphRequest(
  'GET',
  `${getConfig().phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,name_status,code_verification_status,platform_type,throughput`,
);

module.exports = {
  WhatsAppApiError,
  RETRY_LATER,
  PAUSE_SENDING,
  toApiError,
  sendTemplate,
  sendText,
  listTemplates,
  createTemplate,
  getPhoneNumberHealth,
};
