const authService = require('../services/auth.service');
const { successResponse } = require('../utils/helpers');

/**
 * SameSite is a deliberate security decision, not something to infer from request
 * headers. Primary source of truth: an explicit env var. `COOKIE_SAMESITE` wins if
 * set to a valid value ('strict' | 'lax' | 'none'); otherwise `COOKIE_CROSS_SITE`
 * ('true'/'false') maps to 'none'/'lax'. Only when NEITHER is configured do we fall
 * back to the legacy same-host heuristic below, so behavior is unchanged for any
 * deployment that hasn't set the new vars yet.
 *
 * The old heuristic compared req.get('host') (as Express sees it) to FRONTEND_URL's
 * hostname to guess cross-site-ness. That's fragile behind any reverse proxy —
 * depending on how the proxy forwards the Host header, the backend can see a host
 * that never matches the frontend's origin even when the request is same-site from
 * the browser's point of view, which silently forces SameSite=None (no CSRF
 * protection) in cases where 'lax' would have been correct.
 */
const cookieOptions = (req, maxAge, path = '/') => {
  const explicitSameSite = String(process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
  if (['strict', 'lax', 'none'].includes(explicitSameSite)) {
    return { httpOnly: true, secure: true, sameSite: explicitSameSite, path, maxAge };
  }

  const explicitCrossSite = String(process.env.COOKIE_CROSS_SITE || '').trim().toLowerCase();
  if (explicitCrossSite === 'true' || explicitCrossSite === 'false') {
    return { httpOnly: true, secure: true, sameSite: explicitCrossSite === 'true' ? 'none' : 'lax', path, maxAge };
  }

  // Legacy fallback heuristic — preserved as-is when no explicit config is present.
  const frontend = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const apiHost = String(req.get('host') || '').split(':')[0];
  let frontendHost = '';
  try {
    frontendHost = frontend ? new URL(frontend).hostname : '';
  } catch {
    frontendHost = '';
  }
  const crossSite = Boolean(frontendHost && apiHost && frontendHost !== apiHost);
  return {
    httpOnly: true,
    secure: true,
    sameSite: crossSite ? 'none' : 'lax',
    path,
    maxAge,
  };
};

/** Sets both session cookies the exact same way every login path issues a session. */
const issueSessionCookies = (req, res, accessToken, refreshToken) => {
  res.cookie('accessToken', accessToken, cookieOptions(req, 24 * 60 * 60 * 1000));
  res.cookie(
    'refreshToken',
    refreshToken,
    cookieOptions(req, 7 * 24 * 60 * 60 * 1000, '/api/auth')
  );
};

const login = async (req, res, next) => {
  try {
    const { employee, accessToken, refreshToken } = await authService.login(req.body.email, req.body.password);
    issueSessionCookies(req, res, accessToken, refreshToken);
    // Tokens stay in HttpOnly cookies and are never exposed to frontend JavaScript.
    successResponse(res, 'Login successful', { employee });
  } catch (err) { next(err); }
};

/** One handler for all three portal-scoped logins — `portal` is fixed per route, never client-supplied. */
const loginToPortal = (portal) => async (req, res, next) => {
  try {
    const { employee, accessToken, refreshToken } = await authService.loginToPortal(
      portal, req.body.email, req.body.password, req.tenantCompany?.id || null
    );
    issueSessionCookies(req, res, accessToken, refreshToken);
    successResponse(res, 'Login successful', { employee });
  } catch (err) { next(err); }
};

const loginAdmin = loginToPortal('admin');
const loginHr = loginToPortal('hr');
const loginEmployee = loginToPortal('employee');

/** Public — safe fields only, used to brand a tenant's login pages before anyone signs in. */
const workspaceInfo = async (req, res, next) => {
  try {
    if (!req.tenantCompany) {
      return successResponse(res, 'No workspace resolved for this host', { resolved: false });
    }
    successResponse(res, 'Workspace resolved', {
      resolved: true,
      name: req.tenantCompany.name,
      slug: req.tenantCompany.slug,
      isActive: req.tenantCompany.is_active,
    });
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
    const result = await authService.forgotPassword(req.body.email, req.tenantCompany?.id || null);
    successResponse(res, result.message, {
      nextResendAt: result.nextResendAt || null,
      retryAfterSeconds: result.retryAfterSeconds ?? null,
      attemptsRemaining: result.attemptsRemaining ?? 3,
    });
  } catch (err) { next(err); }
};

const resetPassword = async (req, res, next) => {
  try {
    await authService.resetPassword(req.body.email, req.body.otp, req.body.newPassword, req.tenantCompany?.id || null);
    successResponse(res, 'Password reset successful');
  } catch (err) { next(err); }
};

const sendOnboardingOtp = async (req, res, next) => {
  try {
    const email = req.body.email;
    const adminName = req.body.adminName || req.body.admin_name || '';
    const inviteToken = req.body.inviteToken || req.body.invite_token || null;
    const result = await authService.sendOnboardingOtp(email, adminName, inviteToken);
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
      inviteToken: body.inviteToken || body.invite_token,
      logoFile: req.file || null,
    });
    successResponse(res, 'Admin account ready', employee, null, 201);
  } catch (err) { next(err); }
};

const peekOnboardingInvite = async (req, res, next) => {
  try {
    const token = req.params.token || req.query.token;
    const superAdminService = require('../services/superAdmin.service');
    const data = await superAdminService.peekInvite(token);
    successResponse(res, 'Invite is valid', data);
  } catch (err) { next(err); }
};

module.exports = {
  login, loginAdmin, loginHr, loginEmployee, workspaceInfo,
  logout, refreshToken, getMe, changePassword, forgotPassword, resetPassword,
  sendOnboardingOtp, verifyOnboardingOtp, bootstrapAdmin, peekOnboardingInvite,
};
