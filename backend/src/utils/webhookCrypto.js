const crypto = require('crypto');

/**
 * At-rest encryption for webhook signing secrets — same AES-256-GCM
 * pattern already used for 2FA secrets (utils/totp.js), but with its OWN
 * dedicated key rather than reusing SUPER_ADMIN_2FA_ENC_KEY: these are a
 * different class of secret with a different owner/rotation lifecycle,
 * and sharing an encryption key across unrelated secret types is the
 * wrong tradeoff even as a fallback. A webhook secret has to be
 * retrievable in plaintext (to compute the HMAC signature on every
 * delivery) — hashing it one-way like apiKey.service.js's hashKey would
 * make delivery impossible, so encryption (reversible) is the correct
 * primitive here, not hashing.
 */
const getEncryptionKey = () => {
  const raw = process.env.WEBHOOK_SECRET_ENC_KEY;
  if (!raw) {
    throw new Error('WEBHOOK_SECRET_ENC_KEY is not set — required to store/read webhook signing secrets. Set a 32-byte key (base64 or hex).');
  }
  let key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== 32) key = crypto.createHash('sha256').update(raw).digest();
  return key;
};

const encryptWebhookSecret = (plainSecret) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

const decryptWebhookSecret = (encryptedB64) => {
  const key = getEncryptionKey();
  const raw = Buffer.from(encryptedB64, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

module.exports = { encryptWebhookSecret, decryptWebhookSecret };
