const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { getCompanyId } = require('../utils/tenant');

const KEY_PREFIX_LIVE = 'hrms_live_';
const KEY_PREFIX_TEST = 'hrms_test_';
const LOOKUP_PREFIX_LEN = 16; // e.g. hrms_live_a1b2

const ALLOWED_SCOPES = new Set([
  'attendance:write',
  'employees:read',
  'ping',
]);

const hashKey = (rawKey) =>
  crypto.createHash('sha256').update(String(rawKey), 'utf8').digest('hex');

const timingSafeEqualHex = (a, b) => {
  try {
    const bufA = Buffer.from(String(a), 'utf8');
    const bufB = Buffer.from(String(b), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

const normalizeScopes = (scopes) => {
  const list = Array.isArray(scopes) ? scopes : [];
  const cleaned = [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];
  if (!cleaned.length) {
    throw new BadRequestError('At least one scope is required');
  }
  for (const s of cleaned) {
    if (!ALLOWED_SCOPES.has(s)) {
      throw new BadRequestError(`Invalid scope: ${s}`);
    }
  }
  return cleaned;
};

const generateRawKey = (environment = 'live') => {
  const env = environment === 'test' ? 'test' : 'live';
  const prefix = env === 'test' ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
  const secret = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  return `${prefix}${secret}`;
};

const publicRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    key_prefix: row.key_prefix,
    environment: row.environment,
    scopes: row.scopes || [],
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    expires_at: row.expires_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Never include key_hash
  };
};

/**
 * Create a new company-scoped API key.
 * Returns the plaintext key ONCE as `plaintextKey` — it is not stored.
 */
const createApiKey = async (actor, { name, scopes, environment = 'live', expires_at = null }) => {
  const companyId = actor.company_id || getCompanyId(actor);
  if (!companyId) throw new BadRequestError('Company context required');

  const trimmedName = String(name || '').trim();
  if (trimmedName.length < 2) throw new BadRequestError('Name must be at least 2 characters');
  if (trimmedName.length > 120) throw new BadRequestError('Name is too long');

  const env = environment === 'test' ? 'test' : 'live';
  const scopeList = normalizeScopes(scopes);
  const rawKey = generateRawKey(env);
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, LOOKUP_PREFIX_LEN);

  let expiresAt = null;
  if (expires_at) {
    const d = new Date(expires_at);
    if (Number.isNaN(d.getTime())) throw new BadRequestError('Invalid expires_at');
    if (d.getTime() <= Date.now()) throw new BadRequestError('expires_at must be in the future');
    expiresAt = d.toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .insert({
      company_id: companyId,
      name: trimmedName,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      environment: env,
      scopes: scopeList,
      expires_at: expiresAt,
      created_by: actor.id || null,
    })
    .select('*')
    .single();

  if (error) throw new BadRequestError(error.message);

  return {
    ...publicRow(data),
    // Shown only on create — client must copy it now
    plaintextKey: rawKey,
  };
};

const listApiKeys = async (actor) => {
  const companyId = actor.company_id || getCompanyId(actor);
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new BadRequestError(error.message);
  return (data || []).map(publicRow);
};

const revokeApiKey = async (actor, keyId) => {
  const companyId = actor.company_id || getCompanyId(actor);
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('api_keys')
    .select('*')
    .eq('id', keyId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (findErr) throw new BadRequestError(findErr.message);
  if (!existing) throw new NotFoundError('API key not found');
  if (existing.revoked_at) return publicRow(existing);

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return publicRow(data);
};

/**
 * Verify an incoming raw API key. Returns public key row + company_id, or null.
 */
const verifyApiKey = async (rawKey) => {
  const key = String(rawKey || '').trim();
  if (!key.startsWith(KEY_PREFIX_LIVE) && !key.startsWith(KEY_PREFIX_TEST)) {
    return null;
  }
  if (key.length < LOOKUP_PREFIX_LEN + 16) return null;

  const prefix = key.slice(0, LOOKUP_PREFIX_LEN);
  const keyHash = hashKey(key);

  const { data: rows, error } = await supabaseAdmin
    .from('api_keys')
    .select('*')
    .eq('key_prefix', prefix)
    .is('revoked_at', null)
    .limit(5);

  if (error || !rows?.length) return null;

  const match = rows.find((row) => timingSafeEqualHex(row.key_hash, keyHash));
  if (!match) return null;

  if (match.expires_at && new Date(match.expires_at).getTime() <= Date.now()) {
    return null;
  }

  // Fire-and-forget last_used_at (do not block auth)
  supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', match.id)
    .then(() => {})
    .catch(() => {});

  return publicRow(match);
};

const hasScope = (apiKeyOrUser, scope) => {
  const scopes = apiKeyOrUser?.scopes || [];
  return Array.isArray(scopes) && scopes.includes(scope);
};

const assertCompanyOwnsKey = (actor, row) => {
  const companyId = actor.company_id || getCompanyId(actor);
  if (String(row.company_id) !== String(companyId)) {
    throw new ForbiddenError('Not authorized for this API key');
  }
};

module.exports = {
  ALLOWED_SCOPES: [...ALLOWED_SCOPES],
  hashKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
  hasScope,
  assertCompanyOwnsKey,
  publicRow,
};
