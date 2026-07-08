const authService = require('../services/auth.service');
const { successResponse } = require('../utils/helpers');
const config = require('../config/database');

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 24 * 60 * 60 * 1000,
};

const refreshCookieOptions = {
  ...cookieOptions,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const register = async (req, res, next) => {
  try {
    const employee = await authService.register(req.user, req.body);
    successResponse(res, 'User registered successfully', employee, null, 201);
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { employee, accessToken, refreshToken } = await authService.login(req.body.email, req.body.password);
    res.cookie('accessToken', accessToken, cookieOptions);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    successResponse(res, 'Login successful', { employee, accessToken, refreshToken });
  } catch (err) { next(err); }
};

const logout = async (req, res, next) => {
  try {
    await authService.logout(req.user.id, req.cookies?.refreshToken);
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    successResponse(res, 'Logged out successfully');
  } catch (err) { next(err); }
};

const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body.refreshToken;
    const result = await authService.refreshAccessToken(token);
    res.cookie('accessToken', result.accessToken, cookieOptions);
    res.cookie('refreshToken', result.refreshToken, refreshCookieOptions);
    successResponse(res, 'Token refreshed', result);
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
    successResponse(res, result.message);
  } catch (err) { next(err); }
};

const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body.email, req.body.otp, req.body.newPassword);
    successResponse(res, 'Password reset successful');
  } catch (err) { next(err); }
};

module.exports = {
  register, login, logout, refreshToken, getMe, changePassword, forgotPassword, resetPassword,
};
