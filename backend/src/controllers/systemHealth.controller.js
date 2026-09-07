const systemHealthService = require('../services/systemHealth.service');
const impersonationService = require('../services/impersonation.service');
const { successResponse } = require('../utils/helpers');

const getHealth = async (req, res, next) => {
  try {
    successResponse(res, 'System health', await systemHealthService.getSystemHealth());
  } catch (err) { next(err); }
};

const getCrons = async (req, res, next) => {
  try {
    successResponse(res, 'Cron status', await systemHealthService.getCronStatus());
  } catch (err) { next(err); }
};

const getEmailFailures = async (req, res, next) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
    successResponse(res, 'Email failures', await systemHealthService.getEmailFailures(hours));
  } catch (err) { next(err); }
};

const getActiveImpersonations = async (req, res, next) => {
  try {
    successResponse(res, 'Active impersonation sessions', await impersonationService.listActiveSessions());
  } catch (err) { next(err); }
};

module.exports = { getHealth, getCrons, getEmailFailures, getActiveImpersonations };
