const companyService = require('../services/company.service');
const featureOverrideService = require('../services/featureOverride.service');
const exportGateService = require('../services/exportGate.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

/**
 * Bugfix: apiRequest (the frontend's shared API client) runs every response
 * through toCamelCase, which recursively renames OBJECT KEYS — fine for a
 * normal record (snake_case DB columns -> camelCase fields), but this
 * endpoint returns a FLAT MAP where the registry key itself (biometric_adms,
 * ip_based_web, gps_geofence, api_access, advanced_reports, ...) IS the
 * object key. Sending those as-is meant every one containing an underscore
 * arrived on the frontend already renamed (biometric_adms -> biometricAdms)
 * while every consumer (useCompanyFeatures()'s callers in Sidebar,
 * AttendanceConfigSection, GenericSections, lib/constants.js's nav gating)
 * still looked up the snake_case key — always undefined, so every gated
 * section silently vanished regardless of the real entitlement value. Keys
 * without an underscore (payroll, training, assets, helpdesk, recruitment)
 * were never affected, which is why only SOME sections looked broken.
 * Fixed by camelCasing the keys here, at the source, so the frontend
 * transform is idempotent on them — every consumer now reads the same
 * camelCase key that's actually on the object, matching how every other
 * API response already works in this codebase.
 */
const toCamelKey = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const myFeatures = async (req, res, next) => {
  try {
    const { features } = await featureOverrideService.getEffectiveFeatures(companyIdOf(req));
    const flat = Object.fromEntries(features.map((f) => [toCamelKey(f.key), f.effective]));
    successResponse(res, 'Company features fetched', flat);
  } catch (err) { next(err); }
};

/**
 * Item 6: called by the shared ExportButton + exportAllData.js right
 * before running any bulk export — a real server round-trip, not a
 * client-trusted cached flag. Every authenticated role can check this
 * (the export buttons themselves are already role-gated per page; this
 * only adds the subscription-status layer on top).
 */
const exportStatus = async (req, res, next) => {
  try {
    const data = await exportGateService.getExportAuthorization(companyIdOf(req));
    successResponse(res, 'Export authorization', data);
  } catch (err) { next(err); }
};

const getMe = async (req, res, next) => {
  try {
    const data = await companyService.getMyCompany(companyIdOf(req));
    successResponse(res, 'Company fetched', data);
  } catch (err) { next(err); }
};

const listAccessible = async (req, res, next) => {
  try {
    const data = await companyService.listAccessibleCompanies(companyIdOf(req));
    successResponse(res, 'Accessible companies fetched', data);
  } catch (err) { next(err); }
};

/** Current seat usage vs. subscription limit — checked before employee creation, surfaced here for the company admin to see proactively. */
const seatUsage = async (req, res, next) => {
  try {
    const subscriptionService = require('../services/subscription.service');
    const data = await subscriptionService.getSeatUsage(companyIdOf(req));
    successResponse(res, 'Seat usage fetched', data);
  } catch (err) { next(err); }
};

const listChildren = async (req, res, next) => {
  try {
    const data = await companyService.listChildren(companyIdOf(req));
    successResponse(res, 'Child companies fetched', data);
  } catch (err) { next(err); }
};

const createChild = async (req, res, next) => {
  try {
    const data = await companyService.createChild(
      companyIdOf(req),
      req.user.id,
      {
        name: req.body.name,
        slug: req.body.slug,
      },
    );
    successResponse(res, 'Child company created', data, null, 201);
  } catch (err) { next(err); }
};

const updateChild = async (req, res, next) => {
  try {
    const data = await companyService.updateChild(
      companyIdOf(req),
      req.params.id,
      {
        name: req.body.name,
        is_active: req.body.is_active ?? req.body.isActive,
      },
    );
    successResponse(res, 'Child company updated', data);
  } catch (err) { next(err); }
};

const listEmployees = async (req, res, next) => {
  try {
    const data = await companyService.listCompanyEmployees(
      companyIdOf(req),
      req.params.id,
    );
    successResponse(res, 'Company employees fetched', data);
  } catch (err) { next(err); }
};

const uploadLogo = async (req, res, next) => {
  try {
    const data = await companyService.uploadOrgCompanyLogo(
      companyIdOf(req),
      req.params.id,
      req.file,
      req.user.id,
    );
    successResponse(res, 'Company logo uploaded', data);
  } catch (err) { next(err); }
};

const getDetails = async (req, res, next) => {
  try {
    const data = await companyService.getCompanyDetails(companyIdOf(req), req.params.id);
    successResponse(res, 'Company details fetched', data);
  } catch (err) { next(err); }
};

const updateDetails = async (req, res, next) => {
  try {
    const data = await companyService.updateCompanyDetails(
      companyIdOf(req),
      req.params.id,
      req.body || {},
      req.user.id,
    );
    successResponse(res, 'Company details updated', data);
  } catch (err) { next(err); }
};

module.exports = {
  getMe,
  myFeatures,
  exportStatus,
  listAccessible,
  listChildren,
  createChild,
  updateChild,
  listEmployees,
  uploadLogo,
  getDetails,
  updateDetails,
  seatUsage,
};
