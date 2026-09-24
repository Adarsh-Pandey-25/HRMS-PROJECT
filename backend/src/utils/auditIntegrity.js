const crypto = require('crypto');

/**
 * HMAC-SHA256 audit log integrity — signs the insert payload so any
 * subsequent tampering (modified before_state, deleted rows, changed
 * actor attribution) produces a signature mismatch when verified.
 *
 * The key is AUDIT_LOG_HMAC_KEY env var, falling back to JWT_SECRET
 * (logged as a warning). A different key per environment lets you
 * rotate without touching old rows.
 */

const getAuditKey = () => {
  const key = process.env.AUDIT_LOG_HMAC_KEY || process.env.JWT_SECRET;
  if (!process.env.AUDIT_LOG_HMAC_KEY) {
    require('../utils/logger').warn('[AuditIntegrity] AUDIT_LOG_HMAC_KEY not set — falling back to JWT_SECRET for HMAC. Set a dedicated key in production.');
  }
  return crypto.createHash('sha256').update(key).digest();
};

const canonicalize = (fields) => JSON.stringify(fields, Object.keys(fields).sort());

/** Compute the HMAC for a payload. Caller passes only the stable fields. */
const signPayload = (payload) => {
  const key = getAuditKey();
  const canonical = canonicalize(payload);
  return crypto.createHmac('sha256', key).update(canonical).digest('hex');
};

/**
 * Verify a row's stored signature against its current fields.
 * created_at is excluded because it's set by the DB trigger and
 * cannot be tampered with by an attacker.
 */
const verifyRow = (row) => {
  if (!row || !row.signature) return false;
  const payload = {
    company_id: row.company_id,
    actor_id: row.actor_id,
    actor_role: row.actor_role,
    actor_type: row.actor_type,
    super_admin_actor_id: row.super_admin_actor_id,
    action_type: row.action_type,
    target_type: row.target_type,
    target_id: row.target_id,
    before_state: row.before_state,
    after_state: row.after_state,
    ip_address: row.ip_address,
    is_impersonated: row.is_impersonated,
  };
  const expected = signPayload(payload);
  if (row.signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(row.signature), Buffer.from(expected));
};

module.exports = { signPayload, verifyRow };
