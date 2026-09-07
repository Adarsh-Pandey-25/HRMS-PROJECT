const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const {
  BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError,
} = require('../utils/errors');
const { omitSensitive } = require('../utils/helpers');
const logger = require('../utils/logger');
const { slugify, isValidSlugFormat, isSlugTaken, suggestUniqueSlug } = require('../utils/slug');
const totp = require('../utils/totp');

const SALT_ROUNDS = 10;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const generateTokens = (admin) => {
  const payload = {
    id: admin.id,
    email: admin.email,
    role: 'super_admin',
    typ: 'super_admin',
  };
  // Audit finding N-18: super-admin access tokens now sign with their own
  // secret, not the one employee tokens use — see config/database.js.
  const accessToken = jwt.sign(payload, config.jwt.superAdminSecret, { expiresIn: config.jwt.expire });
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

/**
 * Item 6: SUPER_ADMIN_PASSWORD used to sit in .env as a permanent plaintext
 * credential — anyone with read access to the deployment's env vars could
 * read the CURRENT login password indefinitely, not just at first boot.
 * This is a one-time bootstrap only (this whole function is a no-op once a
 * super_admins row already exists for the email), so there's no reason for
 * a long-lived secret to live in .env at all: on the one real first-boot
 * run, generate a random password, hash it into the DB exactly like
 * before, and print the PLAINTEXT once to the startup log — never written
 * to .env, never persisted anywhere outside the log line and the bcrypt
 * hash. Only SUPER_ADMIN_EMAIL (an identifier, not a secret — also reused
 * elsewhere for alert-recipient lookups) remains in .env.
 */
const generateBootstrapPassword = () => {
  // base64url avoids +/= characters that can complicate copy-paste from a
  // log line; appending a fixed-class suffix guarantees this satisfies any
  // "needs a digit + special char" policy regardless of what the random
  // bytes happen to contain, rather than leaving that to chance.
  return `${crypto.randomBytes(24).toString('base64url')}!9`;
};

const ensureSeedSuperAdmin = async () => {
  const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return { seeded: false, reason: 'env_missing' };

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

    const tempPassword = generateBootstrapPassword();
    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
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
    // Security audit finding: this used to go through logger.warn, which
    // (per utils/logger.js) writes to a DailyRotateFile sink in addition to
    // the console — meaning the plaintext password persisted to disk in
    // backend/logs/, directly contradicting the "not stored anywhere in
    // plaintext" claim that used to be printed right below it. Written
    // straight to the raw stderr stream instead, bypassing the logger
    // pipeline entirely, so it only ever exists in this one terminal's
    // scrollback at boot time — never in the rotated/aggregated log files.
    // Not an interactive prompt: this runs during server startup, which is
    // frequently headless/containerized, where blocking on stdin would hang
    // the boot indefinitely.
    const banner = [
      '='.repeat(70),
      'FIRST SUPER ADMIN ACCOUNT CREATED — ONE-TIME BOOTSTRAP CREDENTIAL',
      `Email:    ${email}`,
      `Password: ${tempPassword}`,
      'Copy this now — it is not written to any log file and will not be',
      'shown again. Log in immediately, change the password, then enable 2FA.',
      '='.repeat(70),
      '',
    ].join('\n');
    process.stderr.write(banner);
    logger.warn(`First super admin account created for ${email} — temporary password printed to stderr only, not logged.`);
    return { seeded: true };
  } catch (err) {
    logger.warn('Super admin seed error', { error: err.message });
    return { seeded: false, reason: err.message };
  }
};

/**
 * Module 5 safety rail: the pre-existing password check and token issuance
 * are untouched for any admin with 2FA disabled — this is exactly the old
 * behavior, so the current super-admin account keeps logging in exactly as
 * before. Only an admin who has ENABLED 2FA (via the enrollment flow below,
 * a real UI action) takes the second-step branch.
 */
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

  if (admin.two_factor_enabled) {
    const pendingToken = jwt.sign(
      { id: admin.id, typ: 'super_admin_2fa_pending' },
      config.jwt.superAdminSecret,
      { expiresIn: '5m' },
    );
    return { twoFactorRequired: true, pendingToken };
  }

  await supabaseAdmin
    .from('super_admins')
    .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', admin.id);

  const tokens = generateTokens(admin);
  await storeRefreshToken(admin.id, tokens.refreshToken);
  return {
    admin: {
      ...omitSensitive(admin, ['password_hash', 'two_factor_secret', 'two_factor_pending_secret']),
      // Soft nudge only — not enforced. See Module 5 report: hard-enforcing
      // mandatory 2FA for full_admin before this account has actually
      // enrolled through the real UI would risk locking out the only admin.
      twoFactorSetupRecommended: admin.role === 'full_admin' && !admin.two_factor_enabled,
    },
    ...tokens,
  };
};

/** Second step of a 2FA-gated login: exchange the pending token + a real TOTP code for real session tokens. */
const verifyTwoFactorLogin = async (pendingToken, code) => {
  if (!pendingToken) throw new UnauthorizedError('Login session expired — sign in again');
  let decoded;
  try {
    decoded = jwt.verify(pendingToken, config.jwt.superAdminSecret);
  } catch {
    throw new UnauthorizedError('Login session expired — sign in again');
  }
  if (decoded.typ !== 'super_admin_2fa_pending') throw new ForbiddenError('Invalid login session');

  const { data: admin, error } = await supabaseAdmin
    .from('super_admins')
    .select('*')
    .eq('id', decoded.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !admin) throw new UnauthorizedError('Super admin not found or inactive');
  if (!admin.two_factor_enabled || !admin.two_factor_secret) {
    throw new ConflictError('2FA is not enabled on this account');
  }

  const secret = totp.decryptSecret(admin.two_factor_secret);
  if (!totp.verifyTotp(secret, code)) throw new UnauthorizedError('Invalid or expired authentication code');

  await supabaseAdmin
    .from('super_admins')
    .update({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', admin.id);

  const tokens = generateTokens(admin);
  await storeRefreshToken(admin.id, tokens.refreshToken);
  return {
    admin: omitSensitive(admin, ['password_hash', 'two_factor_secret', 'two_factor_pending_secret']),
    ...tokens,
  };
};

/** Step 1 of enrollment: generate + store a pending secret, return a scannable QR. Not yet active. */
const initiateTwoFactorEnrollment = async (adminId) => {
  const { data: admin, error } = await supabaseAdmin
    .from('super_admins')
    .select('id, email')
    .eq('id', adminId)
    .maybeSingle();
  if (error || !admin) throw new NotFoundError('Super admin not found');

  const secret = totp.generateSecret();
  const encrypted = totp.encryptSecret(secret);
  await supabaseAdmin
    .from('super_admins')
    .update({ two_factor_pending_secret: encrypted, updated_at: new Date().toISOString() })
    .eq('id', adminId);

  const otpauthUri = totp.buildOtpauthUri(secret, admin.email);
  const qrDataUri = await QRCode.toDataURL(otpauthUri);
  return { secret, otpauthUri, qrDataUri };
};

/** Step 2: prove the enrolled app actually works before flipping 2FA on. */
const confirmTwoFactorEnrollment = async (adminId, code) => {
  const { data: admin, error } = await supabaseAdmin
    .from('super_admins')
    .select('id, two_factor_pending_secret')
    .eq('id', adminId)
    .maybeSingle();
  if (error || !admin) throw new NotFoundError('Super admin not found');
  if (!admin.two_factor_pending_secret) throw new BadRequestError('No pending 2FA enrollment — start enrollment first');

  const secret = totp.decryptSecret(admin.two_factor_pending_secret);
  if (!totp.verifyTotp(secret, code)) throw new UnauthorizedError('Invalid code — check your authenticator app and try again');

  await supabaseAdmin
    .from('super_admins')
    .update({
      two_factor_secret: admin.two_factor_pending_secret,
      two_factor_pending_secret: null,
      two_factor_enabled: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId);
  return { enabled: true };
};

/** Requires a valid current code — proves whoever is disabling it still holds the device, not just the session. */
const disableTwoFactor = async (adminId, code) => {
  const { data: admin, error } = await supabaseAdmin
    .from('super_admins')
    .select('id, two_factor_secret, two_factor_enabled')
    .eq('id', adminId)
    .maybeSingle();
  if (error || !admin) throw new NotFoundError('Super admin not found');
  if (!admin.two_factor_enabled) return { enabled: false };

  const secret = totp.decryptSecret(admin.two_factor_secret);
  if (!totp.verifyTotp(secret, code)) throw new UnauthorizedError('Invalid authentication code');

  await supabaseAdmin
    .from('super_admins')
    .update({ two_factor_enabled: false, two_factor_secret: null, two_factor_pending_secret: null, updated_at: new Date().toISOString() })
    .eq('id', adminId);
  return { enabled: false };
};

// ── Module 5: multi-user, role-scoped super admin management ───────────────

const listSuperAdminUsers = async () => {
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .select('id, email, name, role, is_active, two_factor_enabled, last_login_at, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createSuperAdminUser = async (creatorId, { email, password, name, role }) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new BadRequestError('Email is required');
  if (!password || password.length < 8) throw new BadRequestError('Password must be at least 8 characters');
  const validRole = ['full_admin', 'billing_admin', 'support_admin'].includes(role) ? role : 'support_admin';

  const { data: existing } = await supabaseAdmin.from('super_admins').select('id').eq('email', normalized).maybeSingle();
  if (existing) throw new ConflictError('A super admin with this email already exists');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .insert({
      email: normalized, password_hash: passwordHash, name: name || null, role: validRole, created_by: creatorId,
    })
    .select('id, email, name, role, is_active, two_factor_enabled, created_at')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const setSuperAdminActive = async (id, isActive) => {
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .update({ is_active: Boolean(isActive), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, email, name, role, is_active')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Super admin not found');
  return data;
};

const updateSuperAdminRole = async (id, role) => {
  if (!['full_admin', 'billing_admin', 'support_admin'].includes(role)) {
    throw new BadRequestError('Invalid role');
  }
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, email, name, role, is_active')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Super admin not found');
  return data;
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
    .select('id, email, name, is_active, role, two_factor_enabled, last_login_at, created_at')
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
  // Audit finding N-17: never-existed/revoked/used/expired previously each
  // had their own distinguishable message — anyone holding an old invite
  // link (forwarded email, browser history) could learn exactly which of
  // those four states applies. One generic message for all four now;
  // "incomplete" stays separate since it's a different class of problem
  // (a malformed invite record, not a lifecycle-state disclosure).
  const INVALID_INVITE_MESSAGE = 'This invite link is invalid or no longer usable';
  if (!data) throw new ForbiddenError(INVALID_INVITE_MESSAGE);
  if (data.revoked_at) throw new ForbiddenError(INVALID_INVITE_MESSAGE);
  if (data.used_at) throw new ForbiddenError(INVALID_INVITE_MESSAGE);
  if (new Date(data.expires_at) < new Date()) {
    throw new ForbiddenError(INVALID_INVITE_MESSAGE);
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
  verifyTwoFactorLogin,
  initiateTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  listSuperAdminUsers,
  createSuperAdminUser,
  setSuperAdminActive,
  updateSuperAdminRole,
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
