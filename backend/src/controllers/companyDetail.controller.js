const companyDetailService = require('../services/companyDetail.service');
const superAdminService = require('../services/superAdmin.service');
const impersonationService = require('../services/impersonation.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

/**
 * Same logic as auth.controller.js's cookieOptions (duplicated rather than
 * extracted/shared, deliberately — this touches nothing about the existing,
 * already-working employee/super-admin login cookie paths). See that file
 * for the full SameSite rationale.
 */
const employeeCookieOptions = (req, maxAge, path = '/') => {
  const explicitSameSite = String(process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
  if (['strict', 'lax', 'none'].includes(explicitSameSite)) {
    return { httpOnly: true, secure: true, sameSite: explicitSameSite, path, maxAge };
  }
  const explicitCrossSite = String(process.env.COOKIE_CROSS_SITE || '').trim().toLowerCase();
  if (explicitCrossSite === 'true' || explicitCrossSite === 'false') {
    return { httpOnly: true, secure: true, sameSite: explicitCrossSite === 'true' ? 'none' : 'lax', path, maxAge };
  }
  const frontend = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const apiHost = String(req.get('host') || '').split(':')[0];
  let frontendHost = '';
  try {
    frontendHost = frontend ? new URL(frontend).hostname : '';
  } catch {
    frontendHost = '';
  }
  const crossSite = Boolean(frontendHost && apiHost && frontendHost !== apiHost);
  return { httpOnly: true, secure: true, sameSite: crossSite ? 'none' : 'lax', path, maxAge };
};

const getProfile = async (req, res, next) => {
  try {
    successResponse(res, 'Company profile fetched', await companyDetailService.getCompanyProfile(req.params.id));
  } catch (err) { next(err); }
};

const updateProfile = async (req, res, next) => {
  try {
    const data = await companyDetailService.updateCompanyProfile(req.params.id, {
      industry: req.body.industry,
      companySize: req.body.company_size ?? req.body.companySize,
    });
    successResponse(res, 'Company profile updated', data);
  } catch (err) { next(err); }
};

const listEmployees = async (req, res, next) => {
  try {
    const { page, limit } = paginate(req.query);
    const { data, total } = await companyDetailService.listCompanyEmployees(req.params.id, { page, limit, search: req.query.search });
    successResponse(res, 'Company employees fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

const getSubscription = async (req, res, next) => {
  try {
    successResponse(res, 'Company subscription fetched', await companyDetailService.getCompanySubscription(req.params.id));
  } catch (err) { next(err); }
};

const getUsage = async (req, res, next) => {
  try {
    successResponse(res, 'Company usage fetched', await companyDetailService.getCompanyUsage(req.params.id));
  } catch (err) { next(err); }
};

const getAuditLog = async (req, res, next) => {
  try {
    const { page, limit } = paginate(req.query);
    const { data, total } = await auditLogService.listAuditLogs(req.params.id, { page, limit, from: req.query.from, to: req.query.to });
    successResponse(res, 'Company audit log fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

const listNotes = async (req, res, next) => {
  try {
    successResponse(res, 'Notes fetched', await companyDetailService.listNotes(req.params.id));
  } catch (err) { next(err); }
};

const addNote = async (req, res, next) => {
  try {
    const data = await companyDetailService.addNote(req.params.id, req.superAdmin.id, req.body.note);
    successResponse(res, 'Note added', data, null, 201);
  } catch (err) { next(err); }
};

const deleteNote = async (req, res, next) => {
  try {
    successResponse(res, 'Note deleted', await companyDetailService.deleteNote(req.params.id, req.params.noteId));
  } catch (err) { next(err); }
};

/**
 * Company-level suspend/reactivate reuses the existing setCompanyActive —
 * deliberately the SAME toggle as the Companies list page's Activate/
 * Deactivate button, not a new mechanism. This is independent from
 * subscription-level suspend (Module 3's /subscriptions/:id/suspend):
 * companies.is_active blocks login entirely (auth.service.js), while a
 * suspended subscription is a billing-state lock enforced separately
 * (auth.middleware.js's isCompanySuspended). Both are real, already-wired
 * mechanisms in this codebase — kept distinct per the spec's own guidance.
 */
const suspend = async (req, res, next) => {
  try {
    const data = await superAdminService.setCompanyActive(req.params.id, false);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'company_suspended', targetType: 'company', targetId: req.params.id,
    });
    successResponse(res, 'Company suspended', data);
  } catch (err) { next(err); }
};

const reactivate = async (req, res, next) => {
  try {
    const data = await superAdminService.setCompanyActive(req.params.id, true);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'company_reactivated', targetType: 'company', targetId: req.params.id,
    });
    successResponse(res, 'Company reactivated', data);
  } catch (err) { next(err); }
};

// ── Impersonation ────────────────────────────────────────────────────────

/**
 * Sets the SAME `accessToken` cookie a normal employee login sets (short
 * TTL matching the token's own expiry, not the usual 24h) rather than
 * returning the raw JWT in the JSON body — the impersonation token never
 * needs to touch localStorage/JS-visible state; opening the app in a new
 * tab picks up this cookie exactly like any other login would. Distinct
 * from super_admins' own saAccessToken cookie, so no collision with the
 * super-admin panel's own session.
 */
const impersonate = async (req, res, next) => {
  try {
    if (!req.body?.reason) throw new BadRequestError('A reason is required');
    const result = await impersonationService.startImpersonation(
      req.superAdmin.id,
      req.superAdmin.email,
      req.params.id,
      req.body.reason,
      req.ip,
    );
    const ttlMs = new Date(result.expiresAt).getTime() - Date.now();
    res.cookie('accessToken', result.token, employeeCookieOptions(req, Math.max(60_000, ttlMs)));
    successResponse(res, 'Impersonation session started', {
      expiresAt: result.expiresAt,
      company: result.company,
      targetEmployee: result.targetEmployee,
    });
  } catch (err) { next(err); }
};

module.exports = {
  getProfile, updateProfile, listEmployees, getSubscription, getUsage, getAuditLog,
  listNotes, addNote, deleteNote, suspend, reactivate, impersonate,
};
