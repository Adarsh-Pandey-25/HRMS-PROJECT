const { validatePassword } = require('../utils/passwordStrength');
const authService = require('../services/auth.service');
const impersonationService = require('../services/impersonation.service');
const { successResponse } = require('../utils/helpers');
const { BadRequestError, UnauthorizedError, ForbiddenError } = require('../utils/errors');
const employee2faService = require('../services/employee2fa.service');

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
    const result = await authService.login(req.body.email, req.body.password, req.tenantCompany?.id || null);
    if (result.requires2FA) {
      return successResponse(res, 'Two-factor authentication required', {
        requires2FA: true,
        twoFaToken: result.twoFaToken,
        employee: result.employee,
      });
    }
    issueSessionCookies(req, res, result.accessToken, result.refreshToken);
    successResponse(res, 'Login successful', { employee: result.employee });
  } catch (err) { next(err); }
};

/** One handler for all three portal-scoped logins — `portal` is fixed per route, never client-supplied. */
const loginToPortal = (portal) => async (req, res, next) => {
  try {
    const result = await authService.loginToPortal(
      portal, req.body.email, req.body.password, req.tenantCompany?.id || null
    );
    if (result.requires2FA) {
      return successResponse(res, 'Two-factor authentication required', {
        requires2FA: true,
        twoFaToken: result.twoFaToken,
        employee: result.employee,
      });
    }
    issueSessionCookies(req, res, result.accessToken, result.refreshToken);
    successResponse(res, 'Login successful', { employee: result.employee });
  } catch (err) { next(err); }
};

const loginAdmin = loginToPortal('admin');
const loginHr = loginToPortal('hr');
const loginEmployee = loginToPortal('employee');

/** A super-admin impersonating an employee must not change that person's login security. */
const assertNotImpersonating = (req) => {
  if (req.impersonation) throw new ForbiddenError('Two-factor settings cannot be changed during impersonation');
};

const startEmployeeTwoFactor = async (req, res, next) => {
  try {
    assertNotImpersonating(req);
    successResponse(res, 'TOTP secret generated', await employee2faService.generateTotpSecret(req.user.id));
  } catch (err) { next(err); }
};

const confirmEmployeeTwoFactor = async (req, res, next) => {
  try {
    assertNotImpersonating(req);
    await employee2faService.verifyAndEnableTotpFor(req.user.id, req.body.code);
    successResponse(res, 'Two-factor authentication enabled');
  } catch (err) { next(err); }
};

const disableEmployeeTwoFactor = async (req, res, next) => {
  try {
    assertNotImpersonating(req);
    const result = await employee2faService.disableTotp(req.user.id, req.body.code);
    successResponse(res, result.alreadyDisabled ? '2FA was already disabled' : 'Two-factor authentication disabled', result);
  } catch (err) { next(err); }
};

const verifyTwoFaAndLogin = async (req, res, next) => {
  try {
    const { twoFaToken } = req.body;
    if (!twoFaToken) throw new BadRequestError('twoFaToken is required');

    let decoded;
    try {
      decoded = jwt.verify(twoFaToken, process.env.JWT_SECRET);
    } catch {
      throw new BadRequestError('Invalid or expired twoFaToken');
    }
    if (decoded.scope !== 'two_fa_pending') throw new BadRequestError('Invalid token scope');
    if (req.tenantCompany && String(decoded.company_id) !== String(req.tenantCompany.id)) {
      throw new BadRequestError('Invalid or expired twoFaToken');
    }

    const isValid = await employee2faService.verifyTotpCode(decoded.id, req.body.code);
    if (!isValid) throw new UnauthorizedError('Invalid authentication code');

    const result = await authService.completeTwoFaLogin(decoded.id);
    issueSessionCookies(req, res, result.accessToken, result.refreshToken);
    successResponse(res, 'Login successful', { employee: result.employee });
  } catch (err) { next(err); }
};

/**
 * Public — safe fields only, used to brand a tenant's login pages before
 * anyone signs in. This necessarily confirms whether a given subdomain slug
 * maps to a real, active company — an accepted tradeoff, not an oversight:
 * the whole point of the endpoint is to answer that question so the login
 * page can render the right name/logo before authentication. Company slugs
 * are not secrets (the subdomain itself already advertises them to anyone
 * who visits), and nothing sensitive (employee data, counts, settings) is
 * exposed here — only `name`/`slug`/`isActive`.
 */
const workspaceInfo = async (req, res, next) => {
  try {
    if (!req.tenantCompany) {
      return successResponse(res, 'No workspace resolved for this host', { resolved: false });
    }
    // Branding for the login page: logo (short-lived signed URL, same as
    // everywhere else the company logo is shown) and brand colour.
    let logoUrl = null;
    let brandColor = null;
    try {
      const settingsService = require('../services/settings.service');
      const { getSignedUrl, STORAGE_BUCKETS } = require('../services/storage.service');
      const profile = await settingsService.getSetting('company_profile', {}, req.tenantCompany.id) || {};
      const logoPath = profile.logoPath || profile.logo_path || null;
      if (logoPath) logoUrl = await getSignedUrl(STORAGE_BUCKETS.documents, logoPath, 3600);
      brandColor = profile.brandColor || profile.brand_color || null;
    } catch {
      /* branding is cosmetic — the login page still works without it */
    }
    successResponse(res, 'Workspace resolved', {
      resolved: true,
      name: req.tenantCompany.name,
      slug: req.tenantCompany.slug,
      isActive: req.tenantCompany.is_active,
      logoUrl,
      brandColor,
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
    const result = await authService.refreshAccessToken(token, req.tenantCompany?.id || null);
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
    successResponse(res, 'Profile fetched', { ...employee, impersonation: req.impersonation || null });
  } catch (err) { next(err); }
};

/**
 * Called from inside the actual HRMS UI (authenticated as the impersonated
 * employee, not as the super-admin) by the "End Impersonation" banner button.
 * Also naturally ends on its own once the token's hard TTL passes — this
 * just lets the super-admin end it early and closes impersonation_sessions
 * cleanly instead of leaving it to be inferred from the expiry alone.
 */
/** Company host side of the impersonation handoff — see companyDetail.controller.js impersonate(). */
const startImpersonationHandoff = async (req, res, next) => {
  try {
    const { token, expiresAt } = await impersonationService.claimHandoff(
      req.body?.token,
      req.tenantCompany?.id || null,
    );
    const ttlMs = new Date(expiresAt).getTime() - Date.now();
    res.cookie('accessToken', token, cookieOptions(req, Math.max(60_000, ttlMs)));
    successResponse(res, 'Impersonation session active', { expiresAt });
  } catch (err) { next(err); }
};

const endImpersonation = async (req, res, next) => {
  try {
    if (!req.impersonation) throw new BadRequestError('Not in an impersonation session');
    const result = await impersonationService.endImpersonation(
      req.impersonation.sessionId,
      req.impersonation.superAdminId,
      req.user.company_id,
      req.ip,
    );
    // The DB row is now marked ended (auth.middleware.js rejects this
    // token on its next use regardless), but also actively clear the
    // cookies here so the browser stops holding a dead session at all —
    // belt-and-braces alongside the server-side check, not a substitute
    // for it.
    res.clearCookie('accessToken', cookieOptions(req, 0));
    res.clearCookie('refreshToken', cookieOptions(req, 0, '/api/auth'));
    successResponse(res, 'Impersonation session ended', result);
  } catch (err) { next(err); }
};

const markInstallPromptSeen = async (req, res, next) => {
  try {
    await authService.markInstallPromptSeen(req.user.id);
    successResponse(res, 'Install prompt marked as seen');
  } catch (err) { next(err); }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return next(new BadRequestError('Current password and new password are required'));
    }
    validatePassword(newPassword, BadRequestError);
    await authService.changePassword(req.user.id, currentPassword, newPassword);
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
    const inviteToken = req.body.inviteToken || req.body.invite_token || null;
    const result = await authService.verifyOnboardingOtp(req.body.email, req.body.otp, inviteToken);
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

    if (body.password) {
      // Only enforce the complexity policy when the user is actually setting
      // a password themselves. The invite-token path may auto-generate a
      // temporary password server-side, in which case body.password is empty.
      validatePassword(body.password, BadRequestError);
    }

    const employee = await authService.bootstrapAdmin({
      email: body.email || body.admin_email || body.adminEmail,
      password: body.password,
      first_name,
      last_name,
      company_profile: body.company_profile || body.companyProfile || null,
      verificationToken: body.verificationToken || body.verification_token,
      inviteToken: body.inviteToken || body.invite_token,
      workspaceSlug: body.workspaceSlug || body.workspace_slug || null,
      logoFile: req.file || null,
    });
    successResponse(res, 'Admin account ready', employee, null, 201);
  } catch (err) { next(err); }
};

/** Live check for the editable workspace address on the company onboarding page. Needs a valid invite. */
const onboardingSlugAvailability = async (req, res, next) => {
  try {
    const superAdminService = require('../services/superAdmin.service');
    const invite = await superAdminService.assertInviteValid(req.query.inviteToken || req.query.invite_token);
    const { checkSlugAvailability } = require('../utils/slug');
    const result = await checkSlugAvailability(req.query.slug, { excludeInviteId: invite.inviteId });
    successResponse(res, 'Availability checked', result);
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
  sendOnboardingOtp, verifyOnboardingOtp, bootstrapAdmin, peekOnboardingInvite, onboardingSlugAvailability,
  markInstallPromptSeen, startImpersonationHandoff, endImpersonation,
  startEmployeeTwoFactor, confirmEmployeeTwoFactor, disableEmployeeTwoFactor, verifyTwoFaAndLogin,
};
