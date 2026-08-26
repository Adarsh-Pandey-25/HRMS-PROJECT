const superAdminService = require('../services/superAdmin.service');
const { successResponse } = require('../utils/helpers');

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
    const { admin, accessToken, refreshToken } = await superAdminService.login(
      req.body.email,
      req.body.password,
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
  logout,
  refreshToken,
  me,
  listCompanies,
  setCompanyActive,
  suggestSlug,
  createInvite,
  listInvites,
  revokeInvite,
};
