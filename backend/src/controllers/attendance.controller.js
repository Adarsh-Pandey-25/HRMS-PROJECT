const attendanceService = require('../services/attendance.service');
const settingsService = require('../services/settings.service');
const featureOverrideService = require('../services/featureOverride.service');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const { successResponse, getClientIp, getClientIps } = require('../utils/helpers');
const moment = require('moment-timezone');
const { TIMEZONE } = require('../utils/constants');

/**
 * Item 8: display-layer-only biometric visibility gate. Reused across every
 * company-facing attendance read below — never applied to internal callers
 * of attendance.service.js (payroll LOP calc, the anomaly cron), which
 * call those functions directly and always see complete data.
 */
const shouldHideBiometric = async (companyId) => !(await featureOverrideService.hasFeature(companyId, 'biometric_adms'));

/**
 * Security audit finding: attendance.service.js's checkIn/checkOut skip
 * IP-whitelist/GPS-geofence enforcement entirely when method === 'biometric'
 * (that branch exists for the real device path — biometricWebhook below,
 * which hardcodes method: 'biometric' itself and is gated by a company API
 * key, never by req.body). This employee-facing route only ever authenticates
 * via a normal JWT (req.authType === 'jwt', set by auth.middleware.js) — any
 * logged-in employee could otherwise put "method": "biometric" in the
 * request body themselves and bypass office-IP/geofence checks entirely.
 * Rejected here, at the one place both routes' requests actually arrive,
 * rather than relying on each route's own validator to stay in sync.
 */
const rejectSpoofedBiometricMethod = (req) => {
  if (String(req.body?.method || '').toLowerCase() === 'biometric' && req.authType !== 'api_key') {
    throw new (require('../utils/errors').ForbiddenError)('Biometric check-in/out is only available from a registered device');
  }
};

const checkIn = async (req, res, next) => {
  try {
    rejectSpoofedBiometricMethod(req);
    const clientIps = getClientIps(req);
    const clientIp = req.clientIp || getClientIp(req) || clientIps[0] || '';
    const record = await attendanceService.checkIn(req.user.id, {
      ...req.body,
      clientIp,
      clientIps,
    });
    successResponse(res, 'Checked in successfully', record, null, 201);
  } catch (err) { next(err); }
};

const checkOut = async (req, res, next) => {
  try {
    rejectSpoofedBiometricMethod(req);
    const record = await attendanceService.checkOut(req.user.id, {
      method: req.body.method,
      clientIp: req.clientIp,
      break_minutes: req.body.break_minutes,
      location: req.body.location,
    });
    successResponse(res, 'Checked out successfully', record);
  } catch (err) { next(err); }
};

const biometricWebhook = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    // Always bind to the API key's company — never trust body.company_id
    if (!req.user?.is_api_key || !req.user.company_id) {
      throw new (require('../utils/errors').ForbiddenError)('Biometric webhook requires a company API key');
    }
    payload.company_id = req.user.company_id;
    const record = await attendanceService.biometricWebhook(payload);
    successResponse(res, 'Biometric event processed', record);
  } catch (err) { next(err); }
};

const myAttendance = async (req, res, next) => {
  try {
    const filters = { employee_id: req.user.id };
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    const data = (await shouldHideBiometric(req.user.company_id))
      ? attendanceService.stripBiometricRows(result.data)
      : result.data;
    successResponse(res, 'Attendance fetched', data, result.meta);
  } catch (err) { next(err); }
};

const resolveAttendanceEmployeeScope = async (req) => {
  const tenantService = require('../services/tenant.service');
  if (['admin', 'hr'].includes(req.user.role)) {
    return tenantService.getOrgEmployeeIds(req.user.company_id);
  }
  return tenantService.getCompanyEmployeeIds(req.user.company_id);
};

const teamAttendance = async (req, res, next) => {
  try {
    const filters = {};
    const companyEmployeeIds = await resolveAttendanceEmployeeScope(req);
    // Admin/HR see org-wide attendance; managers see direct reports only
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
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
      filters.employee_ids = teamIds;
    }
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    const data = (await shouldHideBiometric(req.user.company_id))
      ? attendanceService.stripBiometricRows(result.data)
      : result.data;
    successResponse(res, 'Team attendance fetched', data, result.meta);
  } catch (err) { next(err); }
};

const allAttendance = async (req, res, next) => {
  try {
    const filters = {
      employee_ids: await resolveAttendanceEmployeeScope(req),
    };
    if (req.query.employee_id) filters.employee_id = req.query.employee_id;
    if (req.query.from) filters.from = req.query.from;
    if (req.query.to) filters.to = req.query.to;
    const result = await attendanceService.getAttendance(filters, req.query);
    const data = (await shouldHideBiometric(req.user.company_id))
      ? attendanceService.stripBiometricRows(result.data)
      : result.data;
    successResponse(res, 'All attendance fetched', data, result.meta);
  } catch (err) { next(err); }
};

const employeeReport = async (req, res, next) => {
  try {
    const employeeId = req.params.employeeId;
    const companyIds = await resolveAttendanceEmployeeScope(req);
    if (!companyIds.includes(employeeId)) {
      throw new (require('../utils/errors').NotFoundError)('Employee not found');
    }
    if (req.user.role === 'employee' && employeeId !== req.user.id) {
      throw new (require('../utils/errors').ForbiddenError)('Not authorized to view this report');
    }
    if (req.user.role === 'manager') {
      const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
      if (employeeId !== req.user.id && !teamIds.includes(employeeId)) {
        throw new (require('../utils/errors').ForbiddenError)('Not authorized to view this report');
      }
    }
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const result = await attendanceService.getMonthlySummary(employeeId, month, year);
    // Item 8: records (individual rows) get biometric rows stripped for
    // display; summary (present/absent/hours counts) is deliberately left
    // untouched — it's computed from the FULL data regardless of this
    // toggle, so a hidden biometric punch can never flip a real present
    // day into a company-visible "absent." See attendance.service.js's
    // stripBiometricRows doc comment for the full reasoning.
    const records = (await shouldHideBiometric(req.user.company_id))
      ? attendanceService.stripBiometricRows(result.records)
      : result.records;
    successResponse(res, 'Attendance report fetched', { ...result, records });
  } catch (err) { next(err); }
};

const manualEntry = async (req, res, next) => {
  try {
    const companyIds = await resolveAttendanceEmployeeScope(req);
    if (!companyIds.includes(req.body.employee_id)) {
      throw new (require('../utils/errors').NotFoundError)('Employee not found');
    }
    const record = await attendanceService.manualEntry(req.user.id, req.body);
    successResponse(res, 'Manual entry created', record, null, 201);
  } catch (err) { next(err); }
};

const monthlySummary = async (req, res, next) => {
  try {
    const employeeId = req.query.employee_id || req.user.id;
    if (employeeId !== req.user.id) {
      const companyIds = await resolveAttendanceEmployeeScope(req);
      if (!companyIds.includes(employeeId)) {
        throw new (require('../utils/errors').NotFoundError)('Employee not found');
      }
      if (req.user.role === 'employee') {
        throw new (require('../utils/errors').ForbiddenError)('Not authorized');
      }
      if (req.user.role === 'manager') {
        const teamIds = await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
        if (!teamIds.includes(employeeId)) {
          throw new (require('../utils/errors').ForbiddenError)('Not authorized');
        }
      }
    }
    const month = parseInt(req.query.month, 10) || moment().tz(TIMEZONE).month() + 1;
    const year = parseInt(req.query.year, 10) || moment().tz(TIMEZONE).year();
    const result = await attendanceService.getMonthlySummary(employeeId, month, year);
    // Item 8: same records-filtered/summary-accurate split as employeeReport above.
    const records = (await shouldHideBiometric(req.user.company_id))
      ? attendanceService.stripBiometricRows(result.records)
      : result.records;
    successResponse(res, 'Monthly summary fetched', { ...result, records });
  } catch (err) { next(err); }
};

const checkContext = async (req, res, next) => {
  try {
    const clientIps = getClientIps(req);
    const clientIp = getClientIp(req) || clientIps[0] || '';
    // Section 0/C: same real ip_whitelist table assertOfficeIpAllowed
    // enforces against at submit time — this used to read the disconnected
    // office_cidr/office_ip settings, which could tell an employee they
    // were "allowed" or "blocked" in a way that didn't match what actually
    // happened when they clicked the button.
    const ipCheck = await attendanceService.isOfficeIpAllowed(clientIp, req.user.company_id, clientIps);
    const isOfficeIp = ipCheck.ok;
    const cidr = ipCheck.reason === 'none_configured' ? '' : 'your office network';

    const featureOverrideService = require('../services/featureOverride.service');
    const [ipWebEntitled, gpsEntitled] = await Promise.all([
      featureOverrideService.hasFeature(req.user.company_id, 'ip_based_web'),
      featureOverrideService.hasFeature(req.user.company_id, 'gps_geofence'),
    ]);

    const { data: emp } = await supabaseAdmin
      .from('employees')
      .select('id, address, company_id')
      .eq('id', req.user.id)
      .single();

    const attendanceConfig = await attendanceService.getAttendanceConfig(req.user.company_id);
    const methods = attendanceConfig.methods;

    const addr = (emp?.address && typeof emp.address === 'object') ? emp.address : {};
    const raw = String(addr.attendance_mode || addr.attendanceMode || 'office').toLowerCase();
    const attendanceMode = raw === 'wfh' || raw === 'remote'
      ? 'wfh'
      : raw === 'hybrid'
        ? 'hybrid'
        : 'office';
    const ipWebOn = ipWebEntitled && methods.ipWeb !== false;
    const gpsOn = gpsEntitled && attendanceConfig.gpsGeofenceEnabled === true;
    const officeIpRequired = attendanceMode === 'office' && ipWebOn && !gpsOn; // GPS-only companies don't need IP
    // OR-by-default (Section E): if either check is on, being pre-flight-ok
    // on ip alone is enough to show "you can check in" — the real
    // authoritative OR/AND logic still runs server-side at submit time in
    // attendance.service.js's checkIn(); this is only a UI hint.
    const canCheckInFromThisIp = attendanceMode !== 'office' || !ipWebOn || isOfficeIp || gpsOn;

    const wfhRequestService = require('../services/wfhRequest.service');
    const todayDate = wfhRequestService.todayIST();
    const wfhReq = await wfhRequestService.getRequestForDate(req.user.id, todayDate);
    const dailyWfhStatus = wfhReq?.status || null;
    const dailyWfhApproved = attendanceMode === 'wfh' || attendanceMode === 'hybrid' || dailyWfhStatus === 'approved';

    // Source of truth for My Attendance clock UI (avoid relying only on month list)
    const shiftStart = attendanceService.resolveShiftStart(emp?.address, attendanceConfig.shifts);
    // On-demand recompute: makes a pending→provisional transition (or a
    // provisional value updating) visible on page load even if the
    // 15-minute periodic sweep hasn't ticked yet. No-op for a non-biometric
    // employee/day (recomputeBiometricWindow finds no punches and returns).
    await attendanceService.recomputeCurrentBiometricWindow(req.user.id);
    const todayRow = await attendanceService.getTodayAttendance(req.user.id, shiftStart);
    const activeOpen = todayRow?.check_out_time
      ? null
      : (todayRow || await attendanceService.getActiveCheckIn(req.user.id));
    const session = todayRow || activeOpen;

    successResponse(res, 'Check-in context fetched', {
      clientIp,
      clientIps,
      officeIp: cidr,
      officeCidr: cidr,
      attendanceMode,
      officeIpRequired,
      canCheckInFromThisIp,
      ipBasedWebOn: ipWebOn,
      gpsGeofenceOn: gpsOn,
      canEnableDailyWfh: attendanceMode === 'office',
      dailyWfhStatus,
      dailyWfhApproved,
      dailyWfhRequestId: wfhReq?.id || null,
      canCheckInAsWfh: dailyWfhApproved,
      methods,
      selfieRequired: attendanceConfig.selfieRequired,
      appCheckInEnabled: methods.app !== false,
      webCheckInEnabled: methods.web !== false,
      ipRequiredForWeb: methods.ipWeb !== false,
      ipRequiredForApp: methods.ipApp === true,
      hint: attendanceMode === 'wfh'
        ? 'WFH employee — check-in allowed from any network'
        : attendanceMode === 'hybrid'
          ? 'Hybrid employee — check-in allowed from any network'
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
            // checkout_status is only meaningful for biometric-sourced rows
            // (web/manual/office_ip rows default to 'finalized' at the DB
            // level and are authoritative the instant they're written).
            checkout_status: session.checkout_status || 'finalized',
            last_punch_at: session.last_punch_at || null,
          }
        : null,
    });
  } catch (err) { next(err); }
};

module.exports = {
  checkIn, checkOut, biometricWebhook, myAttendance, teamAttendance,
  allAttendance, employeeReport, manualEntry, monthlySummary, checkContext,
};
