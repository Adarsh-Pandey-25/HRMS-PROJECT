const { ForbiddenError } = require('../utils/errors');
const featureOverrideService = require('../services/featureOverride.service');
const { getCompanyId } = require('../utils/tenant');

/**
 * One reusable gate for "does this company's plan (or override) include
 * feature X" — reuses featureOverride.service.js's existing override-over-
 * plan-default merge (built for the super-admin Features & Limits tab) so
 * there's a single source of truth for a company's effective feature set,
 * not a second check reimplemented per route.
 */
const requireFeature = (featureKey) => async (req, res, next) => {
  try {
    const companyId = req.user?.company_id || getCompanyId(req.user);
    const enabled = await featureOverrideService.hasFeature(companyId, featureKey);
    if (!enabled) {
      throw new ForbiddenError(`This feature isn't included in your company's current plan. Contact your account administrator to upgrade.`);
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireFeature };
