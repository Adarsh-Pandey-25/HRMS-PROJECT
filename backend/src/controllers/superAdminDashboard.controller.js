const dashboardService = require('../services/superAdminDashboard.service');
const { successResponse } = require('../utils/helpers');

const getSummary = async (req, res, next) => {
  try {
    successResponse(res, 'Dashboard summary', await dashboardService.summary());
  } catch (err) { next(err); }
};

const getGrowth = async (req, res, next) => {
  try {
    const period = req.query.period === '12m' ? '12m' : '6m';
    successResponse(res, 'Growth data', await dashboardService.growth(period));
  } catch (err) { next(err); }
};

const getAttentionFeed = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    successResponse(res, 'Attention feed', await dashboardService.attentionFeed(limit));
  } catch (err) { next(err); }
};

module.exports = { getSummary, getGrowth, getAttentionFeed };
