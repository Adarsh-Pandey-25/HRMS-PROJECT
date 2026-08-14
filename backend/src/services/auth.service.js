const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const {
  BadRequestError, UnauthorizedError, NotFoundError, ConflictError, ForbiddenError, TooManyRequestsError,
} = require('../utils/errors');
const { omitSensitive, generateDefaultPassword } = require('../utils/helpers');
const { allocateNextEmployeeCode } = require('./employeeCode.service');
const { welcomeEmail, passwordResetEmail, onboardingOtpEmail } = require('./email.service');
const settingsService = require('./settings.service');
const logger = require('../utils/logger');
const { getCompanyId, withCompanyId, newCompanyId, companyIdFields } = require('../utils/tenant');
const tenantService = require('./tenant.service');

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

const register = async (adminUser, data) => {
  const { email, first_name, last_name, role, ...rest } = data;

  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) throw new ConflictError('Email already registered');

  const password = generateDefaultPassword(first_name, last_name);
  const passwordHash = await hashPassword(password);
  const companyId = getCompanyId(adminUser);
  const employeeCode = await allocateNextEmployeeCode(companyId);

  const { address: _addr, employee_code: _code, password: _pw, ...restWithoutAddress } = rest;
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .insert({
      email,
      password_hash: passwordHash,
      first_name,
      last_name,
      role,
      employee_code: employeeCode,
      company_id: companyId,
      ...restWithoutAddress,
      address: withCompanyId(rest.address, companyId),
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);

  welcomeEmail(employee, password).catch((e) => logger.warn('Welcome email failed', e.message));
  logger.info('Employee registered', { id: employee.id, by: adminUser.id });

  return omitSensitive(employee, ['password_hash']);
};

const login = async (email, password, options = {}) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !employee) throw new UnauthorizedError('Invalid email or password');
  if (!employee.is_active) throw new ForbiddenError('Account is deactivated');

  const valid = await comparePassword(password, employee.password_hash);
  if (!valid) throw new UnauthorizedError('Invalid email or password');

  const { accessToken, refreshToken } = generateTokens(employee);
  await storeRefreshToken(employee.id, refreshToken);

  return {
    employee: { ...omitSensitive(employee, ['password_hash']), company_id: getCompanyId(employee) },
    accessToken,
    refreshToken,
  };
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
    .select('password_hash')
    .eq('id', employeeId)
    .single();

  const valid = await comparePassword(currentPassword, employee.password_hash);
  if (!valid) throw new UnauthorizedError('Current password is incorrect');

  await assertPasswordPolicy(newPassword);

  const passwordHash = await hashPassword(newPassword);
  await supabaseAdmin
    .from('employees')
    .update({ password_hash: passwordHash })
    .eq('id', employeeId);
};

const forgotPassword = async (email) => {
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

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('email', email)
    .single();

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

  await passwordResetEmail(employee, otp);
  return {
    message: 'If the email exists, an OTP has been sent',
    nextResendAt: guard.nextResendAt,
    retryAfterSeconds: OTP_WAIT_SECONDS[waitIdx],
    attemptsRemaining: OTP_MAX_ATTEMPTS,
  };
};

const resetPassword = async (email, otp, newPassword) => {
  const guard = assertNotOtpLocked(email);

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', email)
    .single();

  if (!employee) {
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
    .eq('employee_id', employee.id)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();

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

  await assertPasswordPolicy(newPassword);

  const passwordHash = await hashPassword(newPassword);
  await supabaseAdmin
    .from('employees')
    .update({ password_hash: passwordHash })
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

const sendOnboardingOtp = async (email, adminName = '') => {
  const key = normalizeEmailKey(email);
  if (!key) throw new BadRequestError('Valid email is required');

  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', key)
    .maybeSingle();
  if (existing) throw new ConflictError('An account with this email already exists');

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

  await onboardingOtpEmail(key, adminName, otp);

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
}) => {
  if (!email) throw new BadRequestError('email is required');
  if (!first_name) throw new BadRequestError('first_name is required');

  assertOnboardingEmailVerified(email, verificationToken);

  const last = last_name || 'Admin';
  const resolvedPassword = password || generateDefaultPassword(first_name, last);
  if (password) await assertPasswordPolicy(password);
  const passwordHash = await hashPassword(resolvedPassword);
  const normalizedEmail = String(email).toLowerCase().trim();

  const { data: existing } = await supabaseAdmin
    .from('employees')
    .select('id, email, role, address')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) {
    // Account recovery must use the verified forgot-password flow.
    throw new ConflictError('An account with this email already exists');
  }

  const companyId = newCompanyId();
  const companyName = company_profile?.name || `${first_name}'s Company`;
  await tenantService.ensureCompanyRow({
    id: companyId,
    name: companyName,
    slug: `co-${String(companyId).replace(/-/g, '')}`,
  });

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
      designation: 'Super Admin',
      date_of_joining: new Date().toISOString().split('T')[0],
      employment_type: 'full_time',
      is_active: true,
      ...companyIdFields(companyId, {}),
    })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);

  await settingsService.seedCompanySettings(companyId, company_profile || {
    name: companyName,
    adminName: `${first_name} ${last}`.trim(),
    adminEmail: normalizedEmail,
  }, data.id);

  consumeOnboardingVerification(normalizedEmail);

  welcomeEmail(data, resolvedPassword).catch((e) => logger.warn('Welcome email failed', e.message));

  logger.info('Onboarding company + admin created', {
    id: data.id, email: data.email, companyId,
  });

  return {
    ...omitSensitive(data, ['password_hash']),
    company_id: companyId,
    // Credentials are emailed — never include plaintext password in the API response.
  };
};

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
  getMe,
  hashPassword,
  sendOnboardingOtp,
  verifyOnboardingOtp,
  bootstrapAdmin,
};
