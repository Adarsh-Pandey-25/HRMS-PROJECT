const dashboardService = require('../services/dashboard.service');
const { successResponse } = require('../utils/helpers');

const getAdminDashboard = async (req, res, next) => {
  try {
    const data = await dashboardService.getAdminDashboard();
    successResponse(res, 'Admin dashboard fetched', data);
  } catch (err) {
    next(err);
  }
};

const getHrDashboard = async (req, res, next) => {
  try {
    const data = await dashboardService.getHrDashboard();
    successResponse(res, 'HR dashboard fetched', data);
  } catch (err) {
    next(err);
  }
};

const getManagerDashboard = async (req, res, next) => {
  try {
    const data = await dashboardService.getManagerDashboard(req.user.id);
    successResponse(res, 'Manager dashboard fetched', data);
  } catch (err) {
    next(err);
  }
};

const getEmployeeDashboard = async (req, res, next) => {
  try {
    const data = await dashboardService.getEmployeeDashboard(req.user.id);
    successResponse(res, 'Employee dashboard fetched', data);
  } catch (err) {
    next(err);
  }
};

const search = async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const data = await dashboardService.globalSearch(q, 8, { role: req.user.role });
    successResponse(res, 'Search results', data);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAdminDashboard,
  getHrDashboard,
  getManagerDashboard,
  getEmployeeDashboard,
  search,
};
