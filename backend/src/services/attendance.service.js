const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const { TIMEZONE, WORK_HOURS } = require('../utils/constants');
const {
  BadRequestError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const {
  calculateWorkingHours, determineAttendanceStatus, nowIST, paginate, buildMeta, ipInCidr,
} = require('../utils/helpers');
const { autoCheckoutEmail } = require('./email.service');
const logger = require('../utils/logger');
const settingsService = require('./settings.service');

/** office = office IP required; wfh = any network; hybrid = any network */
const resolveAttendanceMode = (employee) => {
  const addr = (employee?.address && typeof employee.address === 'object') ? employee.address : {};
  const raw = String(
    employee?.attendance_mode
    || addr.attendance_mode
    || addr.attendanceMode
    || 'office'
  ).toLowerCase();
  if (raw === 'wfh' || raw === 'remote' || raw === 'work_from_home') return 'wfh';
  if (raw === 'hybrid') return 'hybrid';
  return 'office';
};

const assertOfficeIpAllowed = async (clientIp, companyId = null, clientIps = null) => {
  const { officeCidr, officeIp } = await settingsService.getEffectiveOfficeConfig(companyId);
  // Prefer DB whitelist; fall back to seeded office IP
  const cidr = String(officeCidr || officeIp || '').trim();
  if (!cidr) return;
  const { anyIpInCidr } = require('../utils/helpers');
  const ips = Array.isArray(clientIps) && clientIps.length
    ? clientIps
    : [clientIp].filter(Boolean);
  if (!anyIpInCidr(ips, cidr)) {
    throw new ForbiddenError(
      `Check-in allowed only from office network (${cidr}). Your IP: ${ips.join(', ') || clientIp || 'unknown'}`
    );
  }
};

const getActiveCheckIn = async (employeeId) => {
  const { data } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .is('check_out_time', null)
    .order('check_in_time', { ascending: false })
    .limit(1)
    .single();
  return data;
};

/** Any attendance record for the current IST calendar day */
const getTodayAttendance = async (employeeId) => {
  const startOfDay = nowIST().startOf('day').toISOString();
  const endOfDay = nowIST().endOf('day').toISOString();

  const { data } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in_time', startOfDay)
    .lte('check_in_time', endOfDay)
    .order('check_in_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
};

const isWfhLocation = (location) => {
  const loc = (location && typeof location === 'object') ? location : {};
  return Boolean(loc.is_wfh || loc.wfh);
};

const DEFAULT_ATTENDANCE_METHODS = {
  web: true,
  app: true,
  biometric: false,
  ipWeb: true,
  ipApp: false,
};

/** Load company attendance_config with safe defaults. */
const getAttendanceConfig = async (companyId = null) => {
  const raw = await settingsService.getSetting('attendance_config', null, companyId);
  const cfg = (raw && typeof raw === 'object') ? raw : {};
  const methods = { ...DEFAULT_ATTENDANCE_METHODS, ...(cfg.methods || {}) };
  return {
    methods,
    selfieRequired: Boolean(cfg.selfieRequired ?? cfg.selfie_required),
    gracePeriodMinutes: Number(cfg.gracePeriodMinutes ?? cfg.grace_period_minutes ?? 15),
  };
};

/** Map client method names → DB check_in_method values.
 *  Phone and desktop both use web check-in; office IP is the gate (no GPS). */
const normalizeCheckInMethod = (method) => {
  const m = String(method || 'web').toLowerCase().trim();
  if (m === 'biometric') return 'biometric';
  if (m === 'office_ip' || m === 'office-ip') return 'office_ip';
  // app / mobile → same as web (mobile browser)
  return 'web';
};

const assertMethodAllowed = (normalizedMethod, methods) => {
  if (normalizedMethod === 'biometric') {
    if (methods.biometric === false) {
      throw new ForbiddenError('Biometric check-in is disabled in Attendance Config');
    }
    return;
  }
  if (methods.web === false) {
    throw new ForbiddenError('Web check-in is disabled in Attendance Config');
  }
};

const checkIn = async (employeeId, { method, device_id, location, clientIp, clientIps, is_wfh }) => {
  const { data: emp, error: empErr } = await supabaseAdmin
    .from('employees')
    .select('id, address, role, company_id')
    .eq('id', employeeId)
    .single();
  if (empErr) throw new BadRequestError(empErr.message);

  const companyId = require('../utils/tenant').getCompanyId(emp);
  const attendanceConfig = await getAttendanceConfig(companyId);
  const normalizedMethod = normalizeCheckInMethod(method);
  assertMethodAllowed(normalizedMethod, attendanceConfig.methods);

  const baseLocation = (location && typeof location === 'object') ? { ...location } : {};

  const attendanceMode = resolveAttendanceMode(emp || {});
  const isPrivilegedRole = ['admin', 'hr'].includes(emp?.role);
  const wfhRequestService = require('./wfhRequest.service');
  const approvedDailyWfh = await wfhRequestService.isApprovedForDate(employeeId);
  const wantsWfh = attendanceMode === 'wfh' || attendanceMode === 'hybrid' || (Boolean(is_wfh) && approvedDailyWfh);

  if (Boolean(is_wfh) && attendanceMode === 'office' && !approvedDailyWfh && !isPrivilegedRole) {
    throw new ForbiddenError(
      'WFH for today needs Manager/HR approval first. Request it from My Attendance.'
    );
  }

  // Office IP for browser check-in when IP-based Web is enabled (default on).
  const isBiometric = normalizedMethod === 'biometric';
  const ipRequired = attendanceConfig.methods.ipWeb !== false;
  if (attendanceMode === 'office' && !wantsWfh && !isPrivilegedRole && !isBiometric && ipRequired) {
    await assertOfficeIpAllowed(clientIp, companyId, clientIps);
  }

  const todayRecord = await getTodayAttendance(employeeId);
  if (todayRecord) {
    throw new ConflictError(
      todayRecord.check_out_time
        ? 'You have already completed attendance for today. Only one check-in per day is allowed.'
        : 'Already checked in today. Please check out first.'
    );
  }

  const active = await getActiveCheckIn(employeeId);
  if (active) throw new ConflictError('Already checked in. Please check out first.');

  const savedLocation = wantsWfh
    ? { ...baseLocation, is_wfh: true }
    : baseLocation;

  let insertPayload = {
    employee_id: employeeId,
    check_in_time: nowIST().toISOString(),
    check_in_method: normalizedMethod,
    check_in_ip: clientIp,
    device_id: device_id || null,
    location: Object.keys(savedLocation).length ? savedLocation : null,
    status: wantsWfh ? 'wfh' : 'present',
  };

  let { data, error } = await supabaseAdmin
    .from('attendance')
    .insert(insertPayload)
    .select()
    .single();

  if (error && wantsWfh && /invalid input value for enum attendance_status/i.test(error.message || '')) {
    insertPayload = { ...insertPayload, status: 'present' };
    ({ data, error } = await supabaseAdmin
      .from('attendance')
      .insert(insertPayload)
      .select()
      .single());
  }

  if (error) throw new BadRequestError(error.message);
  logger.info('Check-in recorded', {
    employeeId,
    method: normalizedMethod,
    attendanceMode,
    wantsWfh,
    clientIp,
  });
  return { ...data, attendance_mode: attendanceMode, is_wfh: wantsWfh };
};

const checkOut = async (employeeId, { method, clientIp, break_minutes = 0 }) => {
  const todayRecord = await getTodayAttendance(employeeId);
  if (todayRecord?.check_out_time) {
    throw new ConflictError('You have already checked out today. Only one check-out per day is allowed.');
  }

  const active = await getActiveCheckIn(employeeId);
  if (!active) throw new BadRequestError('No active check-in found for today');

  const checkOutTime = nowIST().toISOString();
  const totalHours = calculateWorkingHours(active.check_in_time, checkOutTime) - (break_minutes / 60);
  const overtimeHours = Math.max(0, totalHours - WORK_HOURS);
  const wasWfh = active.status === 'wfh' || isWfhLocation(active.location);
  let status = determineAttendanceStatus(active.check_in_time, totalHours);

  // Payroll rule (admin toggle): if checkout before goal hours, treat as half-day (not early_departure)
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const { data: empRow } = await supabaseAdmin.from('employees').select('address').eq('id', employeeId).maybeSingle();
  const companyId = empRow ? getCompanyId(empRow) : DEFAULT_COMPANY_ID;
  const halfDayBeforeGoal = await settingsService.getBoolean('payroll_halfday_before_goal_enabled', false, companyId);
  if (!wasWfh && halfDayBeforeGoal && totalHours < WORK_HOURS && totalHours > 0) {
    status = 'half_day';
  }
  // Preserve native wfh enum when the check-in used it
  if (active.status === 'wfh') status = 'wfh';

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .update({
      check_out_time: checkOutTime,
      check_out_method: method || active.check_in_method,
      check_out_ip: clientIp,
      break_minutes,
      total_hours: Math.round(totalHours * 100) / 100,
      overtime_hours: Math.round(overtimeHours * 100) / 100,
      status,
      updated_at: checkOutTime,
    })
    .eq('id', active.id)
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const biometricWebhook = async (payload) => {
  const { employee_code, action, timestamp, device_id, company_id } = payload;
  let query = supabaseAdmin
    .from('employees')
    .select('id')
    .eq('employee_code', employee_code);
  if (company_id) query = query.eq('company_id', company_id);
  const { data: employees, error } = await query.limit(2);
  if (error) throw new BadRequestError(error.message);
  if (!employees?.length) throw new NotFoundError('Employee not found');
  if (employees.length > 1) {
    throw new BadRequestError('Multiple employees match this code; company_id is required');
  }
  const employee = employees[0];

  if (action === 'check_in') {
    return checkIn(employee.id, {
      method: 'biometric',
      device_id,
      location: null,
      clientIp: null,
    });
  }
  if (action === 'check_out') {
    return checkOut(employee.id, { method: 'biometric', clientIp: null });
  }
  throw new BadRequestError('Invalid biometric action');
};

const manualEntry = async (hrUserId, data) => {
  const { employee_id, check_in_time, check_out_time, remarks, break_minutes = 0 } = data;

  const dayStart = moment(check_in_time).tz(TIMEZONE).startOf('day').toISOString();
  const dayEnd = moment(check_in_time).tz(TIMEZONE).endOf('day').toISOString();
  const { data: existing } = await supabaseAdmin
    .from('attendance')
    .select('id')
    .eq('employee_id', employee_id)
    .gte('check_in_time', dayStart)
    .lte('check_in_time', dayEnd)
    .limit(1)
    .maybeSingle();

  if (existing) {
    throw new ConflictError('Attendance already exists for this employee on this date');
  }

  const totalHours = check_out_time
    ? calculateWorkingHours(check_in_time, check_out_time) - (break_minutes / 60)
    : null;

  const { data: record, error } = await supabaseAdmin
    .from('attendance')
    .insert({
      employee_id,
      check_in_time,
      check_out_time,
      check_in_method: 'web',
      check_out_method: check_out_time ? 'web' : null,
      break_minutes,
      total_hours: totalHours ? Math.round(totalHours * 100) / 100 : null,
      status: totalHours ? determineAttendanceStatus(check_in_time, totalHours) : 'present',
      remarks: remarks || `Manual entry by HR (${hrUserId})`,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return record;
};

/** Date-only strings become full IST day bounds so same-day filters work. */
const toRangeStart = (value) => {
  if (!value) return null;
  if (String(value).includes('T')) return moment(value).toISOString();
  return moment.tz(value, TIMEZONE).startOf('day').toISOString();
};

const toRangeEnd = (value) => {
  if (!value) return null;
  if (String(value).includes('T')) return moment(value).toISOString();
  return moment.tz(value, TIMEZONE).endOf('day').toISOString();
};

const getAttendance = async (filters, query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 100));
  const offset = (page - 1) * limit;

  if (Array.isArray(filters.employee_ids) && filters.employee_ids.length === 0) {
    return { data: [], meta: buildMeta(page, limit, 0) };
  }

  let dbQuery = supabaseAdmin
    .from('attendance')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department, designation, address)', { count: 'exact' })
    .order('check_in_time', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.employee_id) dbQuery = dbQuery.eq('employee_id', filters.employee_id);
  if (filters.employee_ids) dbQuery = dbQuery.in('employee_id', filters.employee_ids);

  const fromIso = toRangeStart(filters.from);
  const toIso = toRangeEnd(filters.to);
  if (fromIso) dbQuery = dbQuery.gte('check_in_time', fromIso);
  if (toIso) dbQuery = dbQuery.lte('check_in_time', toIso);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);

  // attendance_mode lives in address JSON — expose it on employee for the UI
  const rows = (data || []).map((row) => {
    if (!row?.employee) return row;
    const attendance_mode = resolveAttendanceMode(row.employee);
    return {
      ...row,
      employee: { ...row.employee, attendance_mode },
    };
  });

  return { data: rows, meta: buildMeta(page, limit, count) };
};

const getMonthlySummary = async (employeeId, month, year) => {
  const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).startOf('month');
  const end = start.clone().endOf('month');

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in_time', start.toISOString())
    .lte('check_in_time', end.toISOString());

  if (error) throw new BadRequestError(error.message);

  const rows = data || [];
  const rowIsWfh = (a) => a.status === 'wfh' || isWfhLocation(a.location);
  // Present = office days showed up (on-time, late, or left early). WFH counted separately.
  const present = rows.filter((a) =>
    !rowIsWfh(a) && (['present', 'late', 'early_departure'].includes(a.status) || !a.check_out_time)
  ).length;
  const late = rows.filter((a) => a.status === 'late' && !rowIsWfh(a)).length;
  const halfDay = rows.filter((a) => a.status === 'half_day').length;
  const earlyDeparture = rows.filter((a) => a.status === 'early_departure').length;
  const incomplete = rows.filter((a) => !a.check_out_time).length;
  const totalHours = rows.reduce((sum, a) => sum + (parseFloat(a.total_hours) || 0), 0);
  const overtimeHours = rows.reduce((sum, a) => sum + (parseFloat(a.overtime_hours) || 0), 0);
  const daysWithHours = rows.filter((a) => parseFloat(a.total_hours) > 0).length;

  // Working weekdays in month without an attendance record ≈ absent
  let workingDays = 0;
  const cursor = start.clone();
  while (cursor.isSameOrBefore(end, 'day')) {
    const dow = cursor.day();
    if (dow !== 0 && dow !== 6) workingDays += 1;
    cursor.add(1, 'day');
  }
  const attendedDays = new Set(
    rows.map((a) => moment(a.check_in_time).tz(TIMEZONE).format('YYYY-MM-DD'))
  );
  const today = nowIST();
  const cutoff = today.isBefore(end) ? today.clone().startOf('day') : end.clone();
  let absent = 0;
  const absCursor = start.clone();
  while (absCursor.isSameOrBefore(cutoff, 'day')) {
    const dow = absCursor.day();
    const key = absCursor.format('YYYY-MM-DD');
    if (dow !== 0 && dow !== 6 && !attendedDays.has(key)) absent += 1;
    absCursor.add(1, 'day');
  }

  const summary = {
    totalDays: rows.length,
    workingDays,
    present,
    wfh: rows.filter((a) => rowIsWfh(a)).length,
    late,
    halfDay,
    earlyDeparture,
    absent,
    totalHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    avgHours: daysWithHours ? Math.round((totalHours / daysWithHours) * 10) / 10 : 0,
    incomplete,
  };

  return { records: rows, summary };
};

/** Next 4:00 AM IST boundary after check-in (daily auto-checkout cutoff). */
const getAutoCheckoutDeadline = (checkInTime) => {
  const checkIn = moment(checkInTime).tz(TIMEZONE);
  let deadline = checkIn.clone().startOf('day').hour(4).minute(0).second(0).millisecond(0);
  if (!checkIn.isBefore(deadline)) {
    deadline.add(1, 'day');
  }
  return deadline;
};

const processAutoCheckout = async () => {
  const now = nowIST();

  const { data: activeRecords, error } = await supabaseAdmin
    .from('attendance')
    .select('*, employee:employee_id(id, email, first_name, last_name, address)')
    .is('check_out_time', null);

  if (error) {
    logger.error('Auto checkout fetch failed', { error: error.message });
    return { processed: 0 };
  }

  const halfDayBeforeGoalByCompany = new Map();
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');

  let processed = 0;
  for (const record of activeRecords || []) {
    const deadline = getAutoCheckoutDeadline(record.check_in_time);
    // Only checkout once the 4:00 AM cutoff for this session has passed
    if (now.isBefore(deadline)) continue;

    const companyId = record.employee ? getCompanyId(record.employee) : DEFAULT_COMPANY_ID;
    if (!halfDayBeforeGoalByCompany.has(companyId)) {
      // eslint-disable-next-line no-await-in-loop
      halfDayBeforeGoalByCompany.set(
        companyId,
        await settingsService.getBoolean('payroll_halfday_before_goal_enabled', false, companyId)
      );
    }
    const halfDayBeforeGoal = halfDayBeforeGoalByCompany.get(companyId);

    const checkoutIso = deadline.toISOString();
    const totalHours = calculateWorkingHours(record.check_in_time, checkoutIso);
    let status = determineAttendanceStatus(record.check_in_time, totalHours);

    if (halfDayBeforeGoal && totalHours < WORK_HOURS && totalHours > 0) {
      status = 'half_day';
    }

    await supabaseAdmin
      .from('attendance')
      .update({
        check_out_time: checkoutIso,
        check_out_method: record.check_in_method,
        total_hours: Math.round(totalHours * 100) / 100,
        overtime_hours: Math.max(0, Math.round((totalHours - WORK_HOURS) * 100) / 100),
        status,
        is_auto_checkout: true,
        remarks: 'auto_checkout',
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id);

    if (record.employee) {
      autoCheckoutEmail(record.employee, {
        check_in_time: record.check_in_time,
        total_hours: Math.round(totalHours * 100) / 100,
      }).catch(() => {});
    }
    processed++;
  }

  logger.info('Auto checkout completed', { processed });
  return { processed };
};

const getTeamEmployeeIds = async (managerId) => {
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
    .eq('is_active', true);
  return (data || []).map((e) => e.id);
};

module.exports = {
  checkIn,
  checkOut,
  biometricWebhook,
  manualEntry,
  getAttendance,
  getMonthlySummary,
  processAutoCheckout,
  getTeamEmployeeIds,
  getActiveCheckIn,
  getTodayAttendance,
  getAttendanceConfig,
  normalizeCheckInMethod,
};
