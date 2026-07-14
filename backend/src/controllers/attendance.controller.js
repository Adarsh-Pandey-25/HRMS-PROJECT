const attendanceService = require('../services/attendance.service');
const settingsService = require('../services/settings.service');
const config = require('../config/database');
const { successResponse, getClientIp, ipInCidr } = require('../utils/helpers');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');

const checkIn = async (req, res, next) => {
  try {
    const record = await attendanceService.checkIn(req.user.id, {
      ...req.body,
      clientIp: req.clientIp,
    });
    successResponse(res, 'Checked in successfully', record, null, 201);
  } catch (err) { next(err); }
};

const checkOut = async (req, res, next) => {
  try {
    const record = await attendanceService.checkOut(req.user.id, {
      method: req.body.method,
      clientIp: req.clientIp,
      break_minutes: req.body.break_minutes,
    });
    successResponse(res, 'Checked out successfully', record);
  } catch (err) { next(err); }
};

const biometricWebhook = async (req, res, next) => {
  try {
    const record = await attendanceService.biometricWebhook(req.body);
    successResponse(res, 'Biometric event processed', record);
  } catch (err) { next(err); }
};

const myAttendance = async (req, res, next) => {
  try {
    const filters = { employee_id: req.user.id };
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    successResponse(res, 'Attendance fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const teamAttendance = async (req, res, next) => {
  try {
    const filters = {};
    // Admin/HR see company-wide attendance; managers see direct reports only
    if (['admin', 'hr'].includes(req.user.role)) {
      if (req.query.employee_id) filters.employee_id = req.query.employee_id;
    } else {
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
      filters.employee_ids = teamIds;
    }
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    successResponse(res, 'Team attendance fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const allAttendance = async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.employee_id) filters.employee_id = req.query.employee_id;
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    successResponse(res, 'All attendance fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const employeeReport = async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const result = await attendanceService.getMonthlySummary(req.params.employeeId, month, year);
    successResponse(res, 'Attendance report fetched', result);
  } catch (err) { next(err); }
};

const manualEntry = async (req, res, next) => {
  try {
    const record = await attendanceService.manualEntry(req.user.id, req.body);
    successResponse(res, 'Manual entry created', record, null, 201);
  } catch (err) { next(err); }
};

const monthlySummary = async (req, res, next) => {
  try {
    const employeeId = req.query.employee_id || req.user.id;
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const result = await attendanceService.getMonthlySummary(employeeId, month, year);
    successResponse(res, 'Monthly summary fetched', result);
  } catch (err) { next(err); }
};

const checkContext = async (req, res, next) => {
  try {
    const clientIp = getClientIp(req);
    const { allowRemoteLogin, officeCidr, officeIp } = await settingsService.getEffectiveOfficeConfig();
    const cidr = officeCidr || config.officeCidr;
    const isOfficeIp = ipInCidr(clientIp, cidr);

    successResponse(res, 'Check-in context fetched', {
      clientIp,
      officeIp,
      officeCidr: cidr,
      officeIpRequired: !allowRemoteLogin,
      canCheckInFromThisIp: allowRemoteLogin || isOfficeIp,
    });
  } catch (err) { next(err); }
};

module.exports = {
  checkIn, checkOut, biometricWebhook, myAttendance, teamAttendance,
  allAttendance, employeeReport, manualEntry, monthlySummary, checkContext,
};
