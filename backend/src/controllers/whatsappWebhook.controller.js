const crypto = require('crypto');
const { getConfig } = require('../config/whatsapp');
const { runInBackground } = require('../utils/background');
const logger = require('../utils/logger');
const inbound = require('../services/whatsappInbound.service');

/**
 * Meta's WhatsApp webhook. No session and no CSRF header: Meta signs every
 * delivery with our App Secret (X-Hub-Signature-256 over the raw body), and
 * that signature is the only thing that makes a call trusted. Unsigned or
 * wrongly signed calls are refused before anything is read.
 */

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** True when Meta signed this exact body with our App Secret. */
const isSignedByMeta = (rawBody, header, appSecret) => {
  if (!appSecret || !Buffer.isBuffer(rawBody) || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
};

/** Meta's one-time check when the callback URL is saved in the app dashboard. */
const verify = (req, res) => {
  const cfg = getConfig();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (
    cfg.enabled && cfg.verifyToken && mode === 'subscribe'
    && typeof token === 'string' && safeEqual(token, cfg.verifyToken)
    && typeof challenge === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(challenge)
  ) {
    return res.status(200).type('text/plain').send(challenge);
  }
  return res.sendStatus(403);
};

const receive = (req, res) => {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.appSecret) return res.sendStatus(404);
  if (!isSignedByMeta(req.body, req.get('x-hub-signature-256'), cfg.appSecret)) {
    logger.warn('[WhatsApp] refused a webhook call with a missing or wrong signature');
    return res.sendStatus(401);
  }
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }
  // Answer at once — Meta retries slow webhooks — and do the work after.
  res.sendStatus(200);
  runInBackground('WhatsApp webhook', () => inbound.processWebhook(payload));
  return undefined;
};

module.exports = { verify, receive, isSignedByMeta };
