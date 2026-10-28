const os = require('os');

/**
 * WhatsApp Cloud API settings, read from the environment on every call so a
 * restart or a test always sees the current values. Nothing here is
 * required: with WHATSAPP_ENABLED unset (the default) the channel is off,
 * every hook returns at once, and the server behaves exactly as it did
 * before WhatsApp existed.
 *
 * Outside production, WHATSAPP_ALLOWED_RECIPIENTS is a hard allow-list. A
 * developer's machine runs against the live database, so it must never
 * message a real employee: an empty list sends nothing at all.
 */

// Latest Graph API version on 28 Oct 2026 (v26.0, released 29 Jul 2026).
const DEFAULT_API_VERSION = 'v26.0';

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

const parseRecipients = (raw) => new Set(
  String(raw || '')
    .split(',')
    .map(digitsOnly)
    .filter((digits) => digits.length >= 8),
);

const isProduction = () => process.env.NODE_ENV === 'production';

const getConfig = () => ({
  enabled: String(process.env.WHATSAPP_ENABLED || '').trim().toLowerCase() === 'true',
  apiVersion: String(process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION).trim(),
  phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
  wabaId: String(process.env.WHATSAPP_WABA_ID || '').trim(),
  // The number employees message to connect (wa.me link), digits only.
  businessNumber: digitsOnly(process.env.WHATSAPP_BUSINESS_NUMBER),
  accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
  appSecret: String(process.env.WHATSAPP_APP_SECRET || '').trim(),
  verifyToken: String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim(),
  allowedRecipients: parseRecipients(process.env.WHATSAPP_ALLOWED_RECIPIENTS),
  production: isProduction(),
  // Tags every queued message so production and a developer's machine,
  // sharing one database, only ever send their own rows.
  environment: isProduction() ? 'production' : `dev:${os.hostname()}`.slice(0, 80),
});

/** Settings still missing for the full feature (sending, webhook, connect links). */
const missingSettings = (cfg = getConfig()) => {
  const missing = [];
  if (!cfg.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!cfg.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!cfg.wabaId) missing.push('WHATSAPP_WABA_ID');
  if (!cfg.businessNumber) missing.push('WHATSAPP_BUSINESS_NUMBER');
  if (!cfg.appSecret) missing.push('WHATSAPP_APP_SECRET');
  if (!cfg.verifyToken) missing.push('WHATSAPP_VERIFY_TOKEN');
  if (!cfg.production && cfg.allowedRecipients.size === 0) missing.push('WHATSAPP_ALLOWED_RECIPIENTS');
  return missing;
};

/** Switched on, with what sending needs. */
const canSend = (cfg = getConfig()) => cfg.enabled && Boolean(cfg.accessToken && cfg.phoneNumberId);

/**
 * Production sends to anyone who connected; anywhere else only to numbers on
 * the allow-list. A BSUID-only recipient (number hidden) is never on it.
 */
const isRecipientAllowed = (phone, cfg = getConfig()) => {
  if (cfg.production) return true;
  const digits = digitsOnly(phone);
  return Boolean(digits) && cfg.allowedRecipients.has(digits);
};

module.exports = {
  DEFAULT_API_VERSION,
  digitsOnly,
  getConfig,
  missingSettings,
  canSend,
  isRecipientAllowed,
};
