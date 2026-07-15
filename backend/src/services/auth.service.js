const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const {
  BadRequestError, UnauthorizedError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const { omitSensitive, generateEmployeeCode, generateDefaultPassword } = require('../utils/helpers');
const { welcomeEmail, passwordResetEmail } = require('./email.service');
const settingsService = require('./settings.service');
const logger = require('../utils/logger');

const SALT_ROUNDS = 10;

const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);
const comparePassword = (password, hash) => bcrypt.compare(password, hash);

const assertPasswordPolicy = async (password) => {
  const cfg = await settingsService.getSetting('security_config', null);
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
  const payload = { id: employee.id, email: employee.email, role: employee.role };
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
  const employeeCode = rest.employee_code || generateEmployeeCode();

  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .insert({
      email,
      password_hash: passwordHash,
      first_name,
      last_name,
      role,
      employee_code: employeeCode,
      ...rest,
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
    employee: omitSensitive(employee, ['password_hash']),
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
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('email', email)
    .single();

  if (!employee) {
    return { message: 'If the email exists, an OTP has been sent' };
  }

  // Generate 6-digit OTP and store hashed OTP in DB
  const otp = String(Math.floor(100000 + Math.random() * 900000));
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
  return { message: 'If the email exists, an OTP has been sent' };
};

const resetPassword = async (email, otp, newPassword) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('email', email)
    .single();

  if (!employee) throw new BadRequestError('Invalid or expired OTP');

  const tokenHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
  const { data: resetRecord } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .eq('employee_id', employee.id)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!resetRecord) throw new BadRequestError('Invalid or expired OTP');

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
};

const getMe = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('*, manager:manager_id(id, first_name, last_name, email)')
    .eq('id', employeeId)
    .single();

  if (error || !employee) throw new NotFoundError('Employee not found');
  return omitSensitive(employee, ['password_hash']);
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
};
