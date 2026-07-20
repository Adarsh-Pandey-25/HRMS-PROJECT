const attendanceService = require('../services/attendance.service');
const settingsService = require('../services/settings.service');
const { supabaseAdmin } = require('../config/supabase');
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
    const companyId = req.user.company_id;
    const tenantService = require('../services/tenant.service');
    const companyEmployeeIds = await tenantService.getCompanyEmployeeIds(companyId);
    // Admin/HR see company-wide attendance; managers see direct reports only
    if (['admin', 'hr'].includes(req.user.role)) {
      if (req.query.employee_id) {
        if (!companyEmployeeIds.includes(req.query.employee_id)) {
          throw new (require('../utils/errors').NotFoundError)('Employee not found');
        }
        filters.employee_id = req.query.employee_id;
      } else {
        filters.employee_ids = companyEmployeeIds;
      }
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
    const tenantService = require('../services/tenant.service');
    const filters = {
      employee_ids: await tenantService.getCompanyEmployeeIds(req.user.company_id),
    };
    if (req.query.employee_id) filters.employee_id = req.query.employee_id;
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    successResponse(res, 'All attendance fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const employeeReport = async (req, res, next) => {
  try {
    const employeeId = req.params.employeeId;
    const companyIds = await require('../services/tenant.service')
      .getCompanyEmployeeIds(req.user.company_id);
    if (!companyIds.includes(employeeId)) {
      throw new (require('../utils/errors').NotFoundError)('Employee not found');
    }
    if (req.user.role === 'employee' && employeeId !== req.user.id) {
      throw new (require('../utils/errors').ForbiddenError)('Not authorized to view this report');
    }
    if (req.user.role === 'manager') {
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
      if (employeeId !== req.user.id && !teamIds.includes(employeeId)) {
        throw new (require('../utils/errors').ForbiddenError)('Not authorized to view this report');
      }
    }
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const result = await attendanceService.getMonthlySummary(employeeId, month, year);
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
    if (employeeId !== req.user.id) {
      const companyIds = await require('../services/tenant.service')
        .getCompanyEmployeeIds(req.user.company_id);
      if (!companyIds.includes(employeeId)) {
        throw new (require('../utils/errors').NotFoundError)('Employee not found');
      }
      if (req.user.role === 'employee') {
        throw new (require('../utils/errors').ForbiddenError)('Not authorized');
      }
      if (req.user.role === 'manager') {
        const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id);
        if (!teamIds.includes(employeeId)) {
          throw new (require('../utils/errors').ForbiddenError)('Not authorized');
        }
      }
    }
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const result = await attendanceService.getMonthlySummary(employeeId, month, year);
    successResponse(res, 'Monthly summary fetched', result);
  } catch (err) { next(err); }
};

const checkContext = async (req, res, next) => {
  try {
    const clientIp = getClientIp(req);
    const { officeCidr, officeIp } = await settingsService.getEffectiveOfficeConfig(req.user.company_id);
    const cidr = String(officeCidr || officeIp || config.officeCidr || '').trim();
    const isOfficeIp = cidr ? ipInCidr(clientIp, cidr) : true;

    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, address')
      .eq('id', req.user.id)
      .single();

    const addr = (emp?.address && typeof emp.address === 'object') ? emp.address : {};
    const raw = String(addr.attendance_mode || addr.attendanceMode || 'office').toLowerCase();
    const attendanceMode = (raw === 'wfh' || raw === 'remote') ? 'wfh' : 'office';
    const officeIpRequired = attendanceMode === 'office';
    const canCheckInFromThisIp = !officeIpRequired || isOfficeIp;

    const wfhRequestService = require('../services/wfhRequest.service');
    const todayDate = wfhRequestService.todayIST();
    const wfhReq = await wfhRequestService.getRequestForDate(req.user.id, todayDate);
    const dailyWfhStatus = wfhReq?.status || null;
    const dailyWfhApproved = attendanceMode === 'wfh' || dailyWfhStatus === 'approved';

    // Source of truth for My Attendance clock UI (avoid relying only on month list)
    const todayRow = await attendanceService.getTodayAttendance(req.user.id);
    const activeOpen = todayRow?.check_out_time
      ? null
      : (todayRow || await attendanceService.getActiveCheckIn(req.user.id));
    const session = todayRow || activeOpen;

    successResponse(res, 'Check-in context fetched', {
      clientIp,
      officeIp: officeIp || cidr,
      officeCidr: cidr,
      attendanceMode,
      officeIpRequired,
      canCheckInFromThisIp,
      canEnableDailyWfh: attendanceMode === 'office',
      dailyWfhStatus,
      dailyWfhApproved,
      dailyWfhRequestId: wfhReq?.id || null,
      canCheckInAsWfh: dailyWfhApproved,
      hint: attendanceMode === 'wfh'
        ? 'WFH employee — check-in allowed from any network'
        : dailyWfhStatus === 'approved'
          ? 'WFH approved for today — office IP not required'
          : dailyWfhStatus === 'pending'
            ? 'WFH request pending Manager/HR approval'
            : `Office IP required unless Manager/HR approve WFH for today (${cidr || 'whitelist'})`,
      today: session
        ? {
            id: session.id,
            employee_id: session.employee_id,
            check_in_time: session.check_in_time,
            check_out_time: session.check_out_time,
            check_in_ip: session.check_in_ip,
            check_out_ip: session.check_out_ip,
            total_hours: session.total_hours,
            overtime_hours: session.overtime_hours,
            status: session.status,
            location: session.location,
            is_auto_checkout: session.is_auto_checkout,
            checked_in: Boolean(session.check_in_time),
            checked_out: Boolean(session.check_out_time),
            is_open: Boolean(session.check_in_time && !session.check_out_time),
          }
        : null,
    });
  } catch (err) { next(err); }
};

module.exports = {
  checkIn, checkOut, biometricWebhook, myAttendance, teamAttendance,
  allAttendance, employeeReport, manualEntry, monthlySummary, checkContext,
};
