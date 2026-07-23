const leaveService = require('../services/leave.service');
const attendanceService = require('../services/attendance.service');
const { successResponse } = require('../utils/helpers');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');

const apply = async (req, res, next) => {
  try {
    const leave = await leaveService.applyLeave(req.user.id, req.body);
    successResponse(res, 'Leave applied successfully', leave, null, 201);
  } catch (err) { next(err); }
};

const myLeaves = async (req, res, next) => {
  try {
    const result = await leaveService.getLeaves({ employee_id: req.user.id }, req.query);
    successResponse(res, 'Leaves fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const teamLeaves = async (req, res, next) => {
  try {
    const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
    const filters = { employee_ids: teamIds };
    if (req.query.status) filters.status = req.query.status;
    const result = await leaveService.getLeaves(filters, req.query);
    successResponse(res, 'Team leaves fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const allLeaves = async (req, res, next) => {
  try {
    const tenantService = require('../services/tenant.service');
    const filters = {
      employee_ids: await tenantService.getOrgEmployeeIds(req.user.company_id),
    };
    if (req.query.status) filters.status = req.query.status;
    const result = await leaveService.getLeaves(filters, req.query);
    successResponse(res, 'All leaves fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const approve = async (req, res, next) => {
  try {
    const isManager = req.user.role === 'manager';
    const leave = await leaveService.approveLeave(req.user, req.params.id, isManager);
    successResponse(res, 'Leave approved', leave);
  } catch (err) { next(err); }
};

const reject = async (req, res, next) => {
  try {
    const leave = await leaveService.rejectLeave(req.user, req.params.id, req.body.rejection_reason);
    successResponse(res, 'Leave rejected', leave);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const leave = await leaveService.cancelLeave(req.user.id, req.params.id);
    successResponse(res, 'Leave cancelled', leave);
  } catch (err) { next(err); }
};

const balance = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const { getCompanyId } = require('../utils/tenant');
    const companyId = req.user.company_id || getCompanyId(req.user);
    const tenantService = require('../services/tenant.service');
    const ok = await tenantService.assertSameCompany(companyId, req.params.employeeId);
    if (!ok) {
      return res.status(403).json({ success: false, error: { message: 'Not authorized to view this leave balance' } });
    }
    const balances = await leaveService.getLeaveBalance(req.params.employeeId, year, companyId);
    successResponse(res, 'Leave balance fetched', balances);
  } catch (err) { next(err); }
};

const calendar = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const { getCompanyId } = require('../utils/tenant');
    const companyId = req.user.company_id || getCompanyId(req.user);
    const data = await leaveService.getLeaveCalendar(month, year, companyId);
    successResponse(res, 'Leave calendar fetched', data);
  } catch (err) { next(err); }
};

const types = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const { getCompanyId } = require('../utils/tenant');
    const companyId = req.user.company_id || getCompanyId(req.user);
    const policy = await leaveService.getEffectiveLeavePolicy(year, companyId);
    const active = (policy || []).filter((p) => p.active !== false);
    successResponse(res, 'Leave types fetched', active);
  } catch (err) { next(err); }
};

module.exports = {
  apply, myLeaves, teamLeaves, allLeaves, approve, reject, cancel, balance, calendar, types,
};
