const emailPreferencesService = require('../services/emailPreferences.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

const getCompanyEmailPreferences = async (req, res, next) => {
  try {
    const { company_id } = req.query;
    if (!company_id) {
      return next(new BadRequestError('company_id query parameter is required'));
    }
    successResponse(res, 'Email preferences fetched', await emailPreferencesService.getCompanyEmailPreferences(company_id));
  } catch (err) { next(err); }
};

const setSingleEmailPreference = async (req, res, next) => {
  try {
    const { companyId, category } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return next(new BadRequestError('enabled must be a boolean'));
    }

    const result = await emailPreferencesService.setEmailPreference(
      companyId, category, enabled, req.superAdmin.id,
    );

    if (!result.changed) {
      return successResponse(res, 'No change', { category, enabled: result.newValue });
    }

    successResponse(res, 'Email preference updated', { category, enabled: result.newValue });
  } catch (err) { next(err); }
};

const setBulkEmailPreferences = async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { preferences } = req.body;

    if (!Array.isArray(preferences) || !preferences.length) {
      return next(new BadRequestError('preferences must be a non-empty array'));
    }

    const results = [];
    for (const pref of preferences) {
      if (!pref.category || typeof pref.enabled !== 'boolean') {
        return next(new BadRequestError('Each preference must have category (string) and enabled (boolean)'));
      }
      const result = await emailPreferencesService.setEmailPreference(
        companyId, pref.category, pref.enabled, req.superAdmin.id,
      );
      results.push(result);
    }

    successResponse(res, 'Email preferences updated', { results });
  } catch (err) { next(err); }
};

module.exports = {
  getCompanyEmailPreferences,
  setSingleEmailPreference,
  setBulkEmailPreferences,
};
