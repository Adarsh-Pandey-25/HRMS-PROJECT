const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const {
  BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError,
} = require('../utils/errors');
const { omitSensitive } = require('../utils/helpers');
const logger = require('../utils/logger');
const { slugify, isValidSlugFormat, isSlugTaken, suggestUniqueSlug } = require('../utils/slug');

const SALT_ROUNDS = 10;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const generateTokens = (admin) => {
  const payload = {
    id: admin.id,
    email: admin.email,
    role: 'super_admin',
    typ: 'super_admin',
  };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: config.jwt.expire });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: config.jwt.refreshExpire,
  });
  return { accessToken, refreshToken };
};

/** Same discipline as employee auth: only a hash is stored, rows expire in 7 days. */
const storeRefreshToken = async (superAdminId, refreshToken) => {
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await supabaseAdmin.from('super_admin_refresh_tokens').insert({
    super_admin_id: superAdminId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
};

const ensureSeedSuperAdmin = async () => {
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) return { seeded: false, reason: 'env_missing' };

  try {
    const { data: existing, error } = await supabaseAdmin
      .from('super_admins')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (error) {
      // Table may not exist yet
      logger.warn('Super admin seed skipped', { error: error.message });
      return { seeded: false, reason: error.message };
    }
    if (existing) return { seeded: false, reason: 'exists' };

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { error: insertErr } = await supabaseAdmin.from('super_admins').insert({
      email,
      password_hash: passwordHash,
      name: process.env.SUPER_ADMIN_NAME || 'Platform Super Admin',
      is_active: true,
    });
    if (insertErr) {
      logger.warn('Super admin seed insert failed', { error: insertErr.message });
      return { seeded: false, reason: insertErr.message };
    }
    logger.info('Seeded platform super admin', { email });
    return { seeded: true };
  } catch (err) {
    logger.warn('Super admin seed error', { error: err.message });
    return { seeded: false, reason: err.message };
  }
};

const login = async (email, password) => {
  const normalized = String(email || '').trim().toLowerCase();
  const { data: admin, error } = await supabaseAdmin
    .from('super_admins')
    .select('*')
    .eq('email', normalized)
    .maybeSingle();

  if (error) throw new BadRequestError(error.message);
  if (!admin || admin.is_active === false) throw new UnauthorizedError('Invalid email or password');

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  await supabaseAdmin
    .from('super_admins')
    .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', admin.id);

  const tokens = generateTokens(admin);
  await storeRefreshToken(admin.id, tokens.refreshToken);
  return {
    admin: omitSensitive(admin, ['password_hash']),
    ...tokens,
  };
};

/** Rotates the refresh token: old row deleted the instant the new one is issued. */
const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) throw new UnauthorizedError('Refresh token required');

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (decoded.typ !== 'super_admin' || decoded.role !== 'super_admin') {
    throw new ForbiddenError('Not a super admin session');
  }

  const tokenHash = hashToken(refreshToken);
  const { data: stored } = await supabaseAdmin
    .from('super_admin_refresh_tokens')
    .select('*')
    .eq('super_admin_id', decoded.id)
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!stored) throw new UnauthorizedError('Refresh token expired or revoked');

  const { data: admin, error } = await supabaseAdmin
    .from('super_admins')
    .select('*')
    .eq('id', decoded.id)
    .eq('is_active', true)
    .single();

  if (error || !admin) throw new UnauthorizedError('Super admin not found');

  const tokens = generateTokens(admin);
  await supabaseAdmin.from('super_admin_refresh_tokens').delete().eq('id', stored.id);
  await storeRefreshToken(admin.id, tokens.refreshToken);

  return {
    ...tokens,
    admin: omitSensitive(admin, ['password_hash']),
  };
};

/** Deletes the stored refresh token on logout (falls back to all-of-admin if none given). */
const logoutSuperAdmin = async (superAdminId, refreshToken) => {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await supabaseAdmin
      .from('super_admin_refresh_tokens')
      .delete()
      .eq('super_admin_id', superAdminId)
      .eq('token_hash', tokenHash);
  } else {
    await supabaseAdmin.from('super_admin_refresh_tokens').delete().eq('super_admin_id', superAdminId);
  }
};

const getMe = async (adminId) => {
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .select('id, email, name, is_active, last_login_at, created_at')
    .eq('id', adminId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new UnauthorizedError('Super admin not found');
  return data;
};

const listCompanies = async () => {
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, slug, is_active, company_type, parent_company_id, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw new BadRequestError(error.message);

  const companies = data || [];
  const ids = companies.map((c) => c.id);
  let counts = {};
  if (ids.length) {
    const { data: emps } = await supabaseAdmin
      .from('employees')
      .select('id, company_id')
      .in('company_id', ids)
      .eq('is_active', true);
    for (const e of emps || []) {
      counts[e.company_id] = (counts[e.company_id] || 0) + 1;
    }
  }

  return companies.map((c) => ({
    ...c,
    employeeCount: counts[c.id] || 0,
  }));
};

const setCompanyActive = async (companyId, isActive) => {
  const { data, error } = await supabaseAdmin
    .from('companies')
    .update({ is_active: Boolean(isActive), updated_at: new Date().toISOString() })
    .eq('id', companyId)
    .select('id, name, slug, is_active, company_type, created_at, updated_at')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Company not found');
  return data;
};

/** Live suggestion for the super-admin UI as they type a company name — editable before submit. */
const suggestSlug = async (companyNameHint) => {
  const name = String(companyNameHint || '').trim();
  if (!name) throw new BadRequestError('Company name is required');
  return { slug: await suggestUniqueSlug(name) };
};

/** Create a one-time onboarding invite. Returns plaintext token once. */
const createInvite = async (superAdminId, {
  email, companyNameHint, expiresInDays = 7, slug = null,
} = {}) => {
  const lockedEmail = String(email || '').trim().toLowerCase();
  const lockedCompanyName = String(companyNameHint || '').trim();
  if (!lockedEmail) throw new BadRequestError('Admin email is required');
  if (!lockedCompanyName) throw new BadRequestError('Company name is required');

  // The super admin may have edited the auto-suggested slug — validate whatever
  // was submitted; if nothing was submitted, suggest and use one automatically.
  let companySlug = slugify(slug || '');
  if (companySlug) {
    if (!isValidSlugFormat(companySlug)) {
      throw new BadRequestError('That subdomain is not available — use lowercase letters, numbers, and hyphens only.');
    }
    if (await isSlugTaken(companySlug)) {
      throw new ConflictError('That subdomain is already taken. Try another.');
    }
  } else {
    companySlug = await suggestUniqueSlug(lockedCompanyName);
  }

  const days = Math.min(30, Math.max(1, Number(expiresInDays) || 7));
  const plaintext = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('onboarding_invites')
    .insert({
      token_hash: tokenHash,
      email: lockedEmail,
      company_name_hint: lockedCompanyName,
      company_slug: companySlug,
      created_by: superAdminId,
      expires_at: expiresAt,
    })
    .select('id, email, company_name_hint, company_slug, expires_at, created_at')
    .single();

  if (error) throw new BadRequestError(error.message);

  const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const inviteUrl = `${frontend}/onboarding?invite=${plaintext}`;

  return {
    invite: data,
    token: plaintext,
    inviteUrl,
    expiresAt,
    companySlug,
  };
};

const listInvites = async () => {
  const { data, error } = await supabaseAdmin
    .from('onboarding_invites')
    .select('id, email, company_name_hint, company_slug, expires_at, used_at, used_by_company_id, revoked_at, created_at, created_by')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new BadRequestError(error.message);
  return (data || []).map((row) => ({
    ...row,
    status: row.revoked_at
      ? 'revoked'
      : row.used_at
        ? 'used'
        : new Date(row.expires_at) < new Date()
          ? 'expired'
          : 'active',
  }));
};

const revokeInvite = async (inviteId) => {
  const { data, error } = await supabaseAdmin
    .from('onboarding_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id, revoked_at')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Invite not found or already used/revoked');
  return data;
};

/**
 * Validate invite for public onboarding. Does not consume.
 * @returns {{ inviteId, email, companyNameHint }}
 */
const assertInviteValid = async (plaintextToken) => {
  if (!plaintextToken || String(plaintextToken).length < 16) {
    throw new ForbiddenError('A valid onboarding invite link is required');
  }
  const tokenHash = hashToken(plaintextToken);
  const { data, error } = await supabaseAdmin
    .from('onboarding_invites')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) throw new BadRequestError(error.message);
  if (!data) throw new ForbiddenError('Invalid onboarding invite link');
  if (data.revoked_at) throw new ForbiddenError('This invite link has been revoked');
  if (data.used_at) throw new ForbiddenError('This invite link has already been used');
  if (new Date(data.expires_at) < new Date()) {
    throw new ForbiddenError('This invite link has expired');
  }
  if (!data.email || !data.company_name_hint) {
    throw new ForbiddenError('This invite is incomplete. Ask the platform administrator for a new link');
  }

  // Invites created before subdomains existed have no slug locked in yet —
  // suggest one now rather than blocking onboarding for a pre-existing link.
  const companySlug = data.company_slug || await suggestUniqueSlug(data.company_name_hint);

  return {
    inviteId: data.id,
    email: data.email,
    companyNameHint: data.company_name_hint,
    companySlug,
    expiresAt: data.expires_at,
  };
};

/** Public preview — safe fields only. */
const peekInvite = async (plaintextToken) => {
  const invite = await assertInviteValid(plaintextToken);
  return {
    valid: true,
    email: invite.email,
    companyNameHint: invite.companyNameHint,
    companySlug: invite.companySlug,
    expiresAt: invite.expiresAt,
  };
};

const consumeInvite = async (plaintextToken, companyId) => {
  const tokenHash = hashToken(plaintextToken);
  const { data, error } = await supabaseAdmin
    .from('onboarding_invites')
    .update({
      used_at: new Date().toISOString(),
      used_by_company_id: companyId,
    })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw new BadRequestError(error.message);
  if (!data) throw new ConflictError('Invite could not be consumed (already used or invalid)');
  return data;
};

module.exports = {
  ensureSeedSuperAdmin,
  login,
  refreshAccessToken,
  logoutSuperAdmin,
  getMe,
  listCompanies,
  setCompanyActive,
  suggestSlug,
  createInvite,
  listInvites,
  revokeInvite,
  assertInviteValid,
  peekInvite,
  consumeInvite,
  generateTokens,
  hashToken,
};
