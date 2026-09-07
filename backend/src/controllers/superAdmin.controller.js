const superAdminService = require('../services/superAdmin.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

/**
 * Item 5: super-admin views must be company-selectable, never one global
 * unscoped dump across every tenant — company_id is required, not optional.
 */
const listAuditLogs = async (req, res, next) => {
  try {
    if (!req.query.company_id) throw new BadRequestError('company_id is required');
    const { page, limit } = paginate(req.query);
    const { data, total } = await auditLogService.listAuditLogs(req.query.company_id, {
      page, limit,
      actorId: req.query.actor_id,
      actionType: req.query.action_type,
      targetType: req.query.target_type,
      from: req.query.from,
      to: req.query.to,
    });
    successResponse(res, 'Audit logs fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

/**
 * Same policy as auth.controller.js's cookieOptions — see that file for the full
 * rationale. Explicit env config (COOKIE_SAMESITE / COOKIE_CROSS_SITE) is the
 * source of truth; the old host-comparison heuristic is only a fallback so nothing
 * changes for a deployment that hasn't set the new vars yet.
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

const login = async (req, res, next) => {
  try {
    const result = await superAdminService.login(req.body.email, req.body.password);
    if (result.twoFactorRequired) {
      successResponse(res, 'Authentication code required', { twoFactorRequired: true, pendingToken: result.pendingToken });
      return;
    }
    const { admin, accessToken, refreshToken } = result;
    res.cookie('saAccessToken', accessToken, cookieOptions(req, 24 * 60 * 60 * 1000));
    res.cookie(
      'saRefreshToken',
      refreshToken,
      cookieOptions(req, 7 * 24 * 60 * 60 * 1000, '/api/super-admin'),
    );
    successResponse(res, 'Super admin login successful', { admin });
  } catch (err) { next(err); }
};

const verifyTwoFactor = async (req, res, next) => {
  try {
    const { admin, accessToken, refreshToken } = await superAdminService.verifyTwoFactorLogin(
      req.body.pending_token || req.body.pendingToken,
      req.body.code,
    );
    res.cookie('saAccessToken', accessToken, cookieOptions(req, 24 * 60 * 60 * 1000));
    res.cookie(
      'saRefreshToken',
      refreshToken,
      cookieOptions(req, 7 * 24 * 60 * 60 * 1000, '/api/super-admin'),
    );
    successResponse(res, 'Super admin login successful', { admin });
  } catch (err) { next(err); }
};

const startTwoFactorEnrollment = async (req, res, next) => {
  try {
    const data = await superAdminService.initiateTwoFactorEnrollment(req.superAdmin.id);
    successResponse(res, 'Scan this QR code with your authenticator app', data);
  } catch (err) { next(err); }
};

const confirmTwoFactorEnrollment = async (req, res, next) => {
  try {
    const data = await superAdminService.confirmTwoFactorEnrollment(req.superAdmin.id, req.body.code);
    successResponse(res, 'Two-factor authentication enabled', data);
  } catch (err) { next(err); }
};

const disableTwoFactor = async (req, res, next) => {
  try {
    const data = await superAdminService.disableTwoFactor(req.superAdmin.id, req.body.code);
    successResponse(res, 'Two-factor authentication disabled', data);
  } catch (err) { next(err); }
};

// ── Module 5: super-admin user management (full_admin only) ────────────────

const listSuperAdminUsers = async (req, res, next) => {
  try {
    successResponse(res, 'Super admin users fetched', await superAdminService.listSuperAdminUsers());
  } catch (err) { next(err); }
};

const createSuperAdminUser = async (req, res, next) => {
  try {
    const data = await superAdminService.createSuperAdminUser(req.superAdmin.id, {
      email: req.body.email,
      password: req.body.password,
      name: req.body.name,
      role: req.body.role,
    });
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id, actionType: 'super_admin_user_created', targetType: 'super_admin', targetId: data.id,
      afterState: { email: data.email, role: data.role }, ipAddress: req.ip,
    });
    successResponse(res, 'Super admin user created', data, null, 201);
  } catch (err) { next(err); }
};

const setSuperAdminActive = async (req, res, next) => {
  try {
    const isActive = req.body.is_active ?? req.body.isActive;
    if (typeof isActive !== 'boolean') throw new BadRequestError('is_active boolean is required');
    const data = await superAdminService.setSuperAdminActive(req.params.id, isActive);
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id, actionType: isActive ? 'super_admin_user_activated' : 'super_admin_user_deactivated',
      targetType: 'super_admin', targetId: req.params.id, ipAddress: req.ip,
    });
    successResponse(res, 'Super admin user updated', data);
  } catch (err) { next(err); }
};

const updateSuperAdminRole = async (req, res, next) => {
  try {
    const data = await superAdminService.updateSuperAdminRole(req.params.id, req.body.role);
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id, actionType: 'super_admin_role_changed', targetType: 'super_admin', targetId: req.params.id,
      afterState: { role: req.body.role }, ipAddress: req.ip,
    });
    successResponse(res, 'Super admin role updated', data);
  } catch (err) { next(err); }
};

const logout = async (req, res, next) => {
  try {
    await superAdminService.logoutSuperAdmin(req.superAdmin.id, req.cookies?.saRefreshToken);
    res.clearCookie('saAccessToken', cookieOptions(req, 0));
    res.clearCookie('saRefreshToken', cookieOptions(req, 0, '/api/super-admin'));
    successResponse(res, 'Logged out');
  } catch (err) { next(err); }
};

const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.saRefreshToken;
    const result = await superAdminService.refreshAccessToken(token);
    res.cookie('saAccessToken', result.accessToken, cookieOptions(req, 24 * 60 * 60 * 1000));
    res.cookie(
      'saRefreshToken',
      result.refreshToken,
      cookieOptions(req, 7 * 24 * 60 * 60 * 1000, '/api/super-admin'),
    );
    successResponse(res, 'Token refreshed');
  } catch (err) { next(err); }
};

const me = async (req, res, next) => {
  try {
    const admin = await superAdminService.getMe(req.superAdmin.id);
    successResponse(res, 'Super admin profile', admin);
  } catch (err) { next(err); }
};

const listCompanies = async (req, res, next) => {
  try {
    const data = await superAdminService.listCompanies();
    successResponse(res, 'Companies fetched', data);
  } catch (err) { next(err); }
};

const setCompanyActive = async (req, res, next) => {
  try {
    const isActive = req.body.is_active ?? req.body.isActive;
    if (typeof isActive !== 'boolean') {
      const err = new (require('../utils/errors').BadRequestError)('is_active boolean is required');
      throw err;
    }
    const data = await superAdminService.setCompanyActive(req.params.id, isActive);
    successResponse(res, 'Company updated', data);
  } catch (err) { next(err); }
};

const createInvite = async (req, res, next) => {
  try {
    const result = await superAdminService.createInvite(req.superAdmin.id, {
      email: req.body.email,
      companyNameHint: req.body.company_name_hint || req.body.companyNameHint,
      expiresInDays: req.body.expires_in_days || req.body.expiresInDays,
      slug: req.body.slug || req.body.company_slug,
    });
    successResponse(res, 'Onboarding invite created', result, null, 201);
  } catch (err) { next(err); }
};

const suggestSlug = async (req, res, next) => {
  try {
    const result = await superAdminService.suggestSlug(req.query.company_name_hint || req.query.companyNameHint || req.query.name);
    successResponse(res, 'Slug suggestion', result);
  } catch (err) { next(err); }
};

const listInvites = async (req, res, next) => {
  try {
    const data = await superAdminService.listInvites();
    successResponse(res, 'Invites fetched', data);
  } catch (err) { next(err); }
};

const revokeInvite = async (req, res, next) => {
  try {
    const data = await superAdminService.revokeInvite(req.params.id);
    successResponse(res, 'Invite revoked', data);
  } catch (err) { next(err); }
};

module.exports = {
  login,
  verifyTwoFactor,
  startTwoFactorEnrollment,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  listSuperAdminUsers,
  createSuperAdminUser,
  setSuperAdminActive,
  updateSuperAdminRole,
  logout,
  refreshToken,
  me,
  listCompanies,
  setCompanyActive,
  suggestSlug,
  createInvite,
  listInvites,
  revokeInvite,
  listAuditLogs,
};
