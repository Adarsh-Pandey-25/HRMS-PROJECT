const crypto = require('crypto');

/**
 * Minimal RFC 6238 TOTP (30s step, 6 digits, SHA-1 — the universal default
 * every authenticator app assumes) plus AES-256-GCM at-rest encryption for
 * the secret. No existing secret-encryption pattern exists elsewhere in this
 * codebase to match (device_secret is plaintext, tokens are one-way hashed —
 * neither fits here since a TOTP secret must be decrypted again to verify
 * codes), so this is a self-contained, dependency-free implementation.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

const base32Encode = (buffer) => {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const chunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
};

const base32Decode = (encoded) => {
  const clean = String(encoded).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
};

const generateSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secretBuffer, counter) => {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0');
};

const generateTotp = (base32Secret, atMs = Date.now()) => {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(base32Secret), counter);
};

/** Accepts a ±1 step window (90s total) to absorb normal clock drift. */
const verifyTotp = (base32Secret, token, atMs = Date.now()) => {
  const cleanToken = String(token || '').trim();
  if (!/^\d{6}$/.test(cleanToken)) return false;
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const secretBuffer = base32Decode(base32Secret);
  for (let drift = -1; drift <= 1; drift += 1) {
    if (hotp(secretBuffer, counter + drift) === cleanToken) return true;
  }
  return false;
};

const buildOtpauthUri = (base32Secret, accountLabel, issuer = 'HRMS Super Admin') => {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};

// ── At-rest encryption for the stored secret ────────────────────────────────

const getEncryptionKey = () => {
  const raw = process.env.SUPER_ADMIN_2FA_ENC_KEY;
  if (!raw) {
    throw new Error('SUPER_ADMIN_2FA_ENC_KEY is not set — required to store/read 2FA secrets. Set a 32-byte key (base64 or hex).');
  }
  let key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== 32) key = crypto.createHash('sha256').update(raw).digest();
  return key;
};

const encryptSecret = (plainSecret) => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

const decryptSecret = (encryptedB64) => {
  const key = getEncryptionKey();
  const raw = Buffer.from(encryptedB64, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

module.exports = {
  generateSecret,
  generateTotp,
  verifyTotp,
  buildOtpauthUri,
  encryptSecret,
  decryptSecret,
};
