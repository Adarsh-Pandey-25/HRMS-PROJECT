const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const {
  BadRequestError, UnauthorizedError, NotFoundError, ForbiddenError, TooManyRequestsError,
} = require('../utils/errors');
const { omitSensitive, generateDefaultPassword } = require('../utils/helpers');
const { allocateNextEmployeeCode } = require('./employeeCode.service');
const { welcomeEmail, passwordResetEmail, onboardingOtpEmail } = require('./email.service');
const settingsService = require('./settings.service');
const logger = require('../utils/logger');
const { getCompanyId, newCompanyId, companyIdFields } = require('../utils/tenant');
const tenantService = require('./tenant.service');
const { uploadCompanyLogo, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');

const SALT_ROUNDS = 10;

/** Max wrong OTP tries before a progressive lockout. */
const OTP_MAX_ATTEMPTS = 3;
/** Lock / resend waits after failed OTP batches: 1m → 3m → 10m */
const OTP_WAIT_SECONDS = [60, 180, 600];

/** In-memory OTP guards keyed by normalized email (survives for process lifetime). */
const otpGuards = new Map();

const normalizeEmailKey = (email) => String(email || '').trim().toLowerCase();

const getOtpGuard = (email) => {
  const key = normalizeEmailKey(email);
  if (!otpGuards.has(key)) {
    otpGuards.set(key, {
      failedAttempts: 0,
      lockLevel: 0,
      lockedUntil: 0,
      resendCount: 0,
      nextResendAt: 0,
    });
  }
  return otpGuards.get(key);
};

const clearOtpGuard = (email) => {
  otpGuards.delete(normalizeEmailKey(email));
};

const waitLabel = (seconds) => {
  const s = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};

const lockDetails = (guard, extra = {}) => {
  const retryAfterSeconds = Math.max(0, Math.ceil((guard.lockedUntil - Date.now()) / 1000));
  return {
    attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - guard.failedAttempts),
    lockedUntil: guard.lockedUntil || null,
    retryAfterSeconds,
    lockLevel: guard.lockLevel,
    ...extra,
  };
};

const assertNotOtpLocked = (email) => {
  const guard = getOtpGuard(email);
  const now = Date.now();
  if (guard.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((guard.lockedUntil - now) / 1000);
    throw new TooManyRequestsError(
      `Too many wrong OTPs. Try again in ${waitLabel(retryAfterSeconds)}.`,
      lockDetails(guard, { retryAfterSeconds }),
    );
  }
  if (guard.lockedUntil && guard.lockedUntil <= now) {
    guard.lockedUntil = 0;
  }
  return guard;
};

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
const comparePassword = (password, hash) => bcrypt.compare(password, hash);

const assertPasswordPolicy = async (password, companyId = null) => {
  const cfg = await settingsService.getSetting('security_config', null, companyId);
  const minLength = Number(cfg?.passwordMinLength ?? cfg?.password_min_length ?? 8);
  const requireSpecial = cfg?.passwordRequireSpecialChar ?? cfg?.password_require_special_char ?? true;
  const requireNumber = cfg?.passwordRequireNumber ?? cfg?.password_require_number ?? true;

  if (!password || password.length < Math.max(1, minLength)) {
    throw new BadRequestError(`Password must be at least ${minLength} characters`);
  }
  if (requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    throw new BadRequestError('Password must include a special character');
  }
  if (requireNumber && !/\d/.test(password)) {
    throw new BadRequestError('Password must include a number');
  }
};

const generateTokens = (employee) => {
  const payload = {
    id: employee.id,
    email: employee.email,
    role: employee.role,
    company_id: getCompanyId(employee),
  };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: config.jwt.expire });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: config.jwt.refreshExpire,
  });
  return { accessToken, refreshToken };
};

const storeRefreshToken = async (employeeId, refreshToken) => {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await supabaseAdmin.from('refresh_tokens').insert({
    employee_id: employeeId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
};

/** Roles allowed to sign in through each subdomain portal path. Manager rides on the employee portal — it isn't a separate administrative surface. */
const PORTAL_ALLOWED_ROLES = {
  admin: ['admin'],
  hr: ['hr'],
  employee: ['employee', 'manager'],
};

/**
 * Shared login core. `tenantCompanyId` scopes the email lookup to one
 * tenant when the request arrived on a resolved subdomain — this is also
 * what lets the same email exist at two different companies, since the
 * lookup is no longer necessarily global. `allowedRoles`, when given,
 * enforces that this account's role matches the portal path it logged in
 * through (checked only AFTER the password itself is verified, so a wrong
 * password never leaks whether the portal/role mismatch is the "real"
 * reason — both cases are wrong until credentials are proven correct).
 */
const authenticateEmployee = async (email, password, { tenantCompanyId = null, allowedRoles = null } = {}) => {
  let query = supabaseAdmin.from('employees').select('*').eq('email', email);
  if (tenantCompanyId) query = query.eq('company_id', tenantCompanyId);
  const { data: employee, error } = await query.maybeSingle();

  if (error || !employee) throw new UnauthorizedError('Invalid email or password');
  if (!employee.is_active) throw new ForbiddenError('Account is deactivated');

  const companyId = getCompanyId(employee);
  if (companyId) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('id, is_active')
      .eq('id', companyId)
      .maybeSingle();
    if (company && company.is_active === false) {
      throw new ForbiddenError('This company workspace is deactivated. Contact your platform administrator.');
    }
  }

  const valid = await comparePassword(password, employee.password_hash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  // Authorization is checked only now — after identity is proven, before any
  // session is issued. A correct password for the wrong portal gets nothing.
  if (allowedRoles && !allowedRoles.includes(employee.role)) {
    throw new ForbiddenError('This account is not authorized to sign in through this portal.');
  }

  const { accessToken, refreshToken } = generateTokens(employee);
  await storeRefreshToken(employee.id, refreshToken);

  return {
    employee: {
      ...omitSensitive(employee, ['password_hash']),
      company_id: companyId,
      must_change_password: Boolean(employee.must_change_password),
    },
    accessToken,
    refreshToken,
  };
};

/** Legacy unscoped login — any role, no tenant scoping. Kept for any existing caller. */
const login = async (email, password) => authenticateEmployee(email, password);

/** Portal-specific logins: role is enforced server-side, company is scoped from the resolved subdomain when present. */
const loginToPortal = async (portal, email, password, tenantCompanyId = null) => {
  const allowedRoles = PORTAL_ALLOWED_ROLES[portal];
  if (!allowedRoles) throw new BadRequestError('Unknown login portal');
  return authenticateEmployee(email, password, { tenantCompanyId, allowedRoles });
};

const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) throw new UnauthorizedError('Refresh token required');

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const { data: stored } = await supabaseAdmin
    .from('refresh_tokens')
    .select('*')
    .eq('employee_id', decoded.id)
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!stored) throw new UnauthorizedError('Refresh token expired or revoked');

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', decoded.id)
    .eq('is_active', true)
    .single();

  if (!employee) throw new UnauthorizedError('User not found');

  const { accessToken, refreshToken: newRefresh } = generateTokens(employee);
  await supabaseAdmin.from('refresh_tokens').delete().eq('id', stored.id);
  await storeRefreshToken(employee.id, newRefresh);

  return {
    accessToken,
    refreshToken: newRefresh,
    employee: omitSensitive(employee, ['password_hash']),
  };
};

const logout = async (employeeId, refreshToken) => {
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await supabaseAdmin
      .from('refresh_tokens')
      .delete()
      .eq('employee_id', employeeId)
      .eq('token_hash', tokenHash);
  } else {
    await supabaseAdmin.from('refresh_tokens').delete().eq('employee_id', employeeId);
  }
};

const changePassword = async (employeeId, currentPassword, newPassword) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('password_hash, must_change_password, company_id, address')
    .eq('id', employeeId)
    .single();

  if (!employee) throw new NotFoundError('Employee not found');

  const mustChange = Boolean(employee.must_change_password);
  if (!mustChange) {
    const valid = await comparePassword(currentPassword, employee.password_hash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');
  } else if (currentPassword) {
    const valid = await comparePassword(currentPassword, employee.password_hash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');
  }

  const companyId = getCompanyId(employee);
  await assertPasswordPolicy(newPassword, companyId);

  const passwordHash = await hashPassword(newPassword);
  await supabaseAdmin
    .from('employees')
    .update({ password_hash: passwordHash, must_change_password: false })
    .eq('id', employeeId);
};

/**
 * Same email can now exist at multiple companies, so a bare email alone
 * doesn't always identify one account. `tenantCompanyId` (from a resolved
 * subdomain) disambiguates when present; without it, an ambiguous match is
 * treated the same as "unknown" rather than guessing which company's
 * account to touch.
 */
const findOneEmployeeByEmail = async (email, tenantCompanyId, selectCols = '*') => {
  let query = supabaseAdmin.from('employees').select(selectCols).eq('email', email);
  if (tenantCompanyId) query = query.eq('company_id', tenantCompanyId);
  const { data } = await query;
  return (data && data.length === 1) ? data[0] : null;
};

const forgotPassword = async (email, tenantCompanyId = null) => {
  const guard = assertNotOtpLocked(email);
  const now = Date.now();

  if (guard.nextResendAt > now) {
    const retryAfterSeconds = Math.ceil((guard.nextResendAt - now) / 1000);
    throw new TooManyRequestsError(
      `Please wait ${waitLabel(retryAfterSeconds)} before requesting another code.`,
      {
        ...lockDetails(guard),
        nextResendAt: guard.nextResendAt,
        retryAfterSeconds,
        reason: 'resend_cooldown',
      },
    );
  }

  const employee = await findOneEmployeeByEmail(email, tenantCompanyId);

  // Always apply progressive resend cooldown (even if email unknown) to avoid enumeration timing
  const waitIdx = Math.min(guard.resendCount, OTP_WAIT_SECONDS.length - 1);
  guard.resendCount += 1;
  guard.nextResendAt = now + OTP_WAIT_SECONDS[waitIdx] * 1000;
  // Reset wrong-OTP streak when a new code is issued
  guard.failedAttempts = 0;

  if (!employee) {
    return {
      message: 'If the email exists, an OTP has been sent',
      nextResendAt: guard.nextResendAt,
      retryAfterSeconds: OTP_WAIT_SECONDS[waitIdx],
      attemptsRemaining: OTP_MAX_ATTEMPTS,
    };
  }

  // Generate 6-digit OTP and store hashed OTP in DB
  const otp = String(crypto.randomInt(100000, 1000000));
  const tokenHash = crypto.createHash('sha256').update(otp).digest('hex');

  // Invalidate any previous active tokens for this user
  await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used: true })
    .eq('employee_id', employee.id)
    .eq('used', false);

  await supabaseAdmin.from('password_reset_tokens').insert({
    employee_id: employee.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
  });

  passwordResetEmail(employee, otp).catch((err) => {
    logger.error('Password reset email failed', { error: err.message });
  });
  return {
    message: 'If the email exists, an OTP has been sent',
    nextResendAt: guard.nextResendAt,
    retryAfterSeconds: OTP_WAIT_SECONDS[waitIdx],
    attemptsRemaining: OTP_MAX_ATTEMPTS,
  };
};

const resetPassword = async (email, otp, newPassword, tenantCompanyId = null) => {
  const guard = assertNotOtpLocked(email);

  let candidateQuery = supabaseAdmin.from('employees').select('id, company_id, address').eq('email', email);
  if (tenantCompanyId) candidateQuery = candidateQuery.eq('company_id', tenantCompanyId);
  const { data: candidates } = await candidateQuery;
  const candidateIds = (candidates || []).map((e) => e.id);

  if (!candidateIds.length) {
    // Count as a failed attempt even for unknown emails (same UX)
    guard.failedAttempts += 1;
    if (guard.failedAttempts >= OTP_MAX_ATTEMPTS) {
      const waitIdx = Math.min(guard.lockLevel, OTP_WAIT_SECONDS.length - 1);
      const waitSec = OTP_WAIT_SECONDS[waitIdx];
      guard.lockLevel += 1;
      guard.failedAttempts = 0;
      guard.lockedUntil = Date.now() + waitSec * 1000;
      throw new TooManyRequestsError(
        `Too many wrong OTPs. Try again in ${waitLabel(waitSec)}.`,
        lockDetails(guard, { retryAfterSeconds: waitSec, reason: 'otp_lockout' }),
      );
    }
    throw new BadRequestError('Invalid or expired OTP', {
      attemptsRemaining: OTP_MAX_ATTEMPTS - guard.failedAttempts,
    });
  }

  const tokenHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
  const { data: resetRecord } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .in('employee_id', candidateIds)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (!resetRecord) {
    guard.failedAttempts += 1;
    if (guard.failedAttempts >= OTP_MAX_ATTEMPTS) {
      const waitIdx = Math.min(guard.lockLevel, OTP_WAIT_SECONDS.length - 1);
      const waitSec = OTP_WAIT_SECONDS[waitIdx];
      guard.lockLevel += 1;
      guard.failedAttempts = 0;
      guard.lockedUntil = Date.now() + waitSec * 1000;
      throw new TooManyRequestsError(
        `Too many wrong OTPs. Try again in ${waitLabel(waitSec)}.`,
        lockDetails(guard, { retryAfterSeconds: waitSec, reason: 'otp_lockout' }),
      );
    }
    throw new BadRequestError(
      `Invalid or expired OTP. ${OTP_MAX_ATTEMPTS - guard.failedAttempts} attempt(s) left.`,
      { attemptsRemaining: OTP_MAX_ATTEMPTS - guard.failedAttempts },
    );
  }

  const employee = candidates.find((e) => e.id === resetRecord.employee_id);
  const companyId = getCompanyId(employee);
  await assertPasswordPolicy(newPassword, companyId);

  const passwordHash = await hashPassword(newPassword);
  await supabaseAdmin
    .from('employees')
    .update({ password_hash: passwordHash, must_change_password: false })
    .eq('id', resetRecord.employee_id);

  await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used: true })
    .eq('id', resetRecord.id);

  clearOtpGuard(email);
};

const getMe = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('*, manager:manager_id(id, first_name, last_name, email)')
    .eq('id', employeeId)
    .single();

  if (error || !employee) throw new NotFoundError('Employee not found');
  return {
    ...omitSensitive(employee, ['password_hash']),
    company_id: getCompanyId(employee),
  };
};

/** In-memory onboarding email OTP store: email -> { hash, expiresAt, failedAttempts, nextResendAt, verifiedToken, verifiedUntil } */
const onboardingOtps = new Map();

const sendOnboardingOtp = async (email, adminName = '', inviteToken = null) => {
  const superAdminService = require('./superAdmin.service');
  const invite = await superAdminService.assertInviteValid(inviteToken);

  const key = normalizeEmailKey(email);
  if (!key) throw new BadRequestError('Valid email is required');
  if (invite.email && invite.email !== key) {
    throw new ForbiddenError('This invite is locked to a different email address');
  }

  // Deliberately no "does this email already exist" check here — this flow
  // creates a BRAND NEW company, and the same person's email may already be
  // an account at a different, unrelated company. That's allowed by design;
  // uniqueness is enforced per-company at the database level, not globally.

  const entry = onboardingOtps.get(key) || {
    hash: null,
    expiresAt: 0,
    failedAttempts: 0,
    nextResendAt: 0,
    verifiedToken: null,
    verifiedUntil: 0,
  };

  const now = Date.now();
  if (entry.nextResendAt > now) {
    const retryAfterSeconds = Math.ceil((entry.nextResendAt - now) / 1000);
    throw new TooManyRequestsError(
      `Please wait ${waitLabel(retryAfterSeconds)} before requesting another code.`,
      { retryAfterSeconds, nextResendAt: entry.nextResendAt, reason: 'resend_cooldown' },
    );
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const tokenHash = crypto.createHash('sha256').update(otp).digest('hex');
  entry.hash = tokenHash;
  entry.expiresAt = now + 10 * 60 * 1000;
  entry.failedAttempts = 0;
  entry.verifiedToken = null;
  entry.verifiedUntil = 0;
  entry.nextResendAt = now + 30 * 1000;
  onboardingOtps.set(key, entry);

  // Do not block the HTTP response on SMTP — Render + Gmail often exceeds 30s.
  onboardingOtpEmail(key, adminName, otp).catch((err) => {
    logger.error('Onboarding OTP email failed', { error: err.message });
  });

  return {
    message: 'OTP sent to your email',
    nextResendAt: entry.nextResendAt,
    retryAfterSeconds: 30,
    expiresInSeconds: 600,
  };
};

const verifyOnboardingOtp = async (email, otp) => {
  const key = normalizeEmailKey(email);
  const entry = onboardingOtps.get(key);
  if (!entry?.hash) throw new BadRequestError('Request an OTP first');

  const now = Date.now();
  if (entry.expiresAt <= now) {
    throw new BadRequestError('OTP expired. Request a new code.');
  }

  if (entry.failedAttempts >= OTP_MAX_ATTEMPTS) {
    throw new TooManyRequestsError(
      'Too many wrong OTPs. Request a new code.',
      { attemptsRemaining: 0, reason: 'otp_lockout' },
    );
  }

  const tokenHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
  if (tokenHash !== entry.hash) {
    entry.failedAttempts += 1;
    onboardingOtps.set(key, entry);
    const left = OTP_MAX_ATTEMPTS - entry.failedAttempts;
    if (left <= 0) {
      throw new TooManyRequestsError(
        'Too many wrong OTPs. Request a new code.',
        { attemptsRemaining: 0, reason: 'otp_lockout' },
      );
    }
    throw new BadRequestError(`Invalid OTP. ${left} attempt(s) left.`, {
      attemptsRemaining: left,
    });
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  entry.verifiedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  entry.verifiedUntil = now + 15 * 60 * 1000;
  entry.hash = null;
  entry.failedAttempts = 0;
  onboardingOtps.set(key, entry);

  return {
    message: 'Email verified',
    verificationToken,
    expiresInSeconds: 900,
  };
};

const assertOnboardingEmailVerified = (email, verificationToken) => {
  const key = normalizeEmailKey(email);
  const entry = onboardingOtps.get(key);
  if (!entry?.verifiedToken || !verificationToken) {
    throw new BadRequestError('Verify your email with OTP before launching');
  }
  if (entry.verifiedUntil <= Date.now()) {
    throw new BadRequestError('Email verification expired. Request a new OTP.');
  }
  const hash = crypto.createHash('sha256').update(String(verificationToken)).digest('hex');
  if (hash !== entry.verifiedToken) {
    throw new BadRequestError('Invalid email verification. Request a new OTP.');
  }
};

const consumeOnboardingVerification = (email) => {
  onboardingOtps.delete(normalizeEmailKey(email));
};

/**
 * Onboarding: create a NEW isolated company workspace + its first admin.
 * Existing demo/legacy employees stay under the default company and are NOT visible here.
 */
const bootstrapAdmin = async ({
  email,
  password,
  first_name,
  last_name,
  company_profile = null,
  verificationToken = null,
  inviteToken = null,
  logoFile = null,
}) => {
  if (!email) throw new BadRequestError('email is required');
  if (!first_name) throw new BadRequestError('first_name is required');

  const superAdminService = require('./superAdmin.service');
  const invite = await superAdminService.assertInviteValid(inviteToken);
  const normalizedEmail = String(email).toLowerCase().trim();
  if (invite.email && invite.email !== normalizedEmail) {
    throw new ForbiddenError('This invite is locked to a different email address');
  }
  const submittedCompanyName = String(company_profile?.name || '').trim();
  if (submittedCompanyName !== invite.companyNameHint) {
    throw new ForbiddenError('The company name must match the onboarding invitation');
  }

  assertOnboardingEmailVerified(email, verificationToken);

  const last = last_name || 'Admin';
  const resolvedPassword = password || generateDefaultPassword();
  await assertPasswordPolicy(resolvedPassword);
  const passwordHash = await hashPassword(resolvedPassword);

  // No global "does this email exist" check here — this creates a BRAND NEW
  // company, and the same email legitimately existing at a different,
  // unrelated company must not block it. The database enforces uniqueness
  // per company, and this is always a fresh company_id, so no collision is
  // possible within it regardless of what exists elsewhere on the platform.

  const companyId = newCompanyId();
  const companyName = invite.companyNameHint;
  await tenantService.ensureCompanyRow({
    id: companyId,
    name: companyName,
    slug: invite.companySlug,
  });

  const profile = {
    ...(company_profile && typeof company_profile === 'object' ? company_profile : {}),
    name: companyName,
  };

  if (logoFile) {
    const ext = String(logoFile.originalname || '').split('.').pop().toLowerCase();
    if (!['png', 'jpg', 'jpeg'].includes(ext)) {
      throw new BadRequestError('Logo must be PNG or JPG');
    }
    if (logoFile.size > 2 * 1024 * 1024) {
      throw new BadRequestError('Logo must be 2MB or smaller');
    }
    const { path } = await uploadCompanyLogo(logoFile, companyId);
    profile.logoPath = path;
    profile.logoName = logoFile.originalname;
  }

  const { data, error } = await supabaseAdmin
    .from('employees')
    .insert({
      employee_code: await allocateNextEmployeeCode(companyId),
      email: normalizedEmail,
      password_hash: passwordHash,
      first_name,
      last_name: last,
      role: 'admin',
      department: 'Administration',
      designation: 'Company Admin',
      date_of_joining: new Date().toISOString().split('T')[0],
      employment_type: 'full_time',
      is_active: true,
      must_change_password: !password,
      ...companyIdFields(companyId, {}),
    })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);

  await settingsService.seedCompanySettings(companyId, {
    ...profile,
    adminName: profile.adminName || `${first_name} ${last}`.trim(),
    adminEmail: profile.adminEmail || normalizedEmail,
  }, data.id);

  await superAdminService.consumeInvite(inviteToken, companyId);
  consumeOnboardingVerification(normalizedEmail);

  welcomeEmail(data, resolvedPassword).catch((e) => logger.warn('Welcome email failed', e.message));

  let logoUrl = null;
  if (profile.logoPath) {
    try {
      logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, profile.logoPath, 86400);
    } catch (err) {
      logger.warn('Onboarding logo URL failed', err.message);
    }
  }

  logger.info('Onboarding company + admin created', {
    id: data.id, email: data.email, companyId, inviteId: invite.inviteId,
  });

  return {
    ...omitSensitive(data, ['password_hash']),
    company_id: companyId,
    logoPath: profile.logoPath || null,
    logoName: profile.logoName || null,
    logoUrl,
    // Credentials are emailed — never include plaintext password in the API response.
  };
};

module.exports = {
  login,
  loginToPortal,
  refreshAccessToken,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
  getMe,
  hashPassword,
  assertPasswordPolicy,
  sendOnboardingOtp,
  verifyOnboardingOtp,
  bootstrapAdmin,
};
