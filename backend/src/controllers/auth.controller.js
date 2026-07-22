const authService = require('../services/auth.service');
const { successResponse } = require('../utils/helpers');
const config = require('../config/database');

const cookieOptions = (req, maxAge, path = '/') => ({
  httpOnly: true,
  secure: config.cookieSecure || req.secure || req.get('x-forwarded-proto') === 'https',
  sameSite: 'strict',
  path,
  maxAge,
});

const register = async (req, res, next) => {
  try {
    const employee = await authService.register(req.user, req.body);
    successResponse(res, 'User registered successfully', employee, null, 201);
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { employee, accessToken, refreshToken } = await authService.login(req.body.email, req.body.password);
    res.cookie('accessToken', accessToken, cookieOptions(req, 24 * 60 * 60 * 1000));
    res.cookie(
      'refreshToken',
      refreshToken,
      cookieOptions(req, 7 * 24 * 60 * 60 * 1000, '/api/auth')
    );
    // Tokens stay in HttpOnly cookies and are never exposed to frontend JavaScript.
    successResponse(res, 'Login successful', { employee });
  } catch (err) { next(err); }
};

const logout = async (req, res, next) => {
  try {
    await authService.logout(req.user.id, req.cookies?.refreshToken);
    res.clearCookie('accessToken', cookieOptions(req, 0));
    res.clearCookie('refreshToken', cookieOptions(req, 0, '/api/auth'));
    successResponse(res, 'Logged out successfully');
  } catch (err) { next(err); }
};

const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    const result = await authService.refreshAccessToken(token);
    res.cookie('accessToken', result.accessToken, cookieOptions(req, 24 * 60 * 60 * 1000));
    res.cookie(
      'refreshToken',
      result.refreshToken,
      cookieOptions(req, 7 * 24 * 60 * 60 * 1000, '/api/auth')
    );
    successResponse(res, 'Token refreshed');
  } catch (err) { next(err); }
};

const getMe = async (req, res, next) => {
  try {
    const employee = await authService.getMe(req.user.id);
    successResponse(res, 'Profile fetched', employee);
  } catch (err) { next(err); }
};

const changePassword = async (req, res, next) => {
  try {
    await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    successResponse(res, 'Password changed successfully');
  } catch (err) { next(err); }
};

const forgotPassword = async (req, res, next) => {
  try {
    const result = await authService.forgotPassword(req.body.email);
    successResponse(res, result.message, {
      nextResendAt: result.nextResendAt || null,
      retryAfterSeconds: result.retryAfterSeconds ?? null,
      attemptsRemaining: result.attemptsRemaining ?? 3,
    });
  } catch (err) { next(err); }
};

const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body.email, req.body.otp, req.body.newPassword);
    successResponse(res, 'Password reset successful');
  } catch (err) { next(err); }
};

const sendOnboardingOtp = async (req, res, next) => {
  try {
    const email = req.body.email;
    const adminName = req.body.adminName || req.body.admin_name || '';
    const result = await authService.sendOnboardingOtp(email, adminName);
    successResponse(res, result.message, {
      nextResendAt: result.nextResendAt,
      retryAfterSeconds: result.retryAfterSeconds,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (err) { next(err); }
};

const verifyOnboardingOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyOnboardingOtp(req.body.email, req.body.otp);
    successResponse(res, result.message, {
      verificationToken: result.verificationToken,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (err) { next(err); }
};

const bootstrapAdmin = async (req, res, next) => {
  try {
    const body = req.body || {};
    const fullName = String(body.admin_name || body.adminName || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const first_name = body.first_name || parts[0] || 'Admin';
    const last_name = body.last_name || (parts.length > 1 ? parts.slice(1).join(' ') : 'User');

    const employee = await authService.bootstrapAdmin({
      email: body.email || body.admin_email || body.adminEmail,
      password: body.password,
      first_name,
      last_name,
      company_profile: body.company_profile || body.companyProfile || null,
      verificationToken: body.verificationToken || body.verification_token,
    });
    successResponse(res, 'Admin account ready', employee, null, 201);
  } catch (err) { next(err); }
};

module.exports = {
  register, login, logout, refreshToken, getMe, changePassword, forgotPassword, resetPassword,
  sendOnboardingOtp, verifyOnboardingOtp, bootstrapAdmin,
};
