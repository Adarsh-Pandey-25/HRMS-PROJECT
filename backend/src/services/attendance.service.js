const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const { TIMEZONE, WORK_HOURS } = require('../utils/constants');
const {
  BadRequestError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const {
  calculateWorkingHours, determineAttendanceStatus, getShiftDayWindow, nowIST, paginate, buildMeta, ipInCidr,
} = require('../utils/helpers');
const { autoCheckoutEmail } = require('./email.service');
const logger = require('../utils/logger');
const settingsService = require('./settings.service');

/** office = office IP required; wfh = any network; hybrid = any network */
const resolveAttendanceMode = (employee) => {
  const addr = (employee?.address && typeof employee.address === 'object') ? employee.address : {};
  const raw = String(addr.attendance_mode || addr.attendanceMode || 'office').toLowerCase();
  if (raw === 'wfh' || raw === 'remote' || raw === 'work_from_home') return 'wfh';
  if (raw === 'hybrid') return 'hybrid';
  return 'office';
};

/**
 * Section 0/C correction: this used to read a single office_cidr/office_ip
 * SETTING that the actual "IP Whitelist" Settings UI never wrote to at all
 * (that UI manages a list in attendance_config.ipWhitelist, a different key
 * entirely) — so for any company only ever using the real UI, `cidr` was
 * always empty and this silently no-opped, allowing check-in from anywhere
 * despite the toggle being on. Now reads the real ip_whitelist table
 * (Section A) — multi-branch, "a match against ANY active entry is
 * sufficient" — and is also exactly what Section D's beacons write into.
 */
/** Boolean check, split out so Section E's OR-logic can try both IP and GPS without one throwing first. */
const isOfficeIpAllowed = async (clientIp, companyId = null, clientIps = null) => {
  if (!companyId) return { ok: true, reason: 'no_company' };
  const { data: entries, error } = await supabaseAdmin
    .from('ip_whitelist')
    .select('cidr')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (error) {
    if (/relation .*ip_whitelist.* does not exist/i.test(error.message || '')) return { ok: true, reason: 'not_migrated' };
    throw new BadRequestError(error.message);
  }
  const cidrs = (entries || []).map((e) => e.cidr).filter(Boolean);
  if (!cidrs.length) return { ok: true, reason: 'none_configured' };

  const { anyIpInCidr } = require('../utils/helpers');
  const ips = Array.isArray(clientIps) && clientIps.length ? clientIps : [clientIp].filter(Boolean);
  const ok = anyIpInCidr(ips, cidrs.join(','));
  return { ok, reason: ok ? 'matched' : 'no_match' };
};

/**
 * Section 0/C correction: this used to read a single office_cidr/office_ip
 * SETTING that the actual "IP Whitelist" Settings UI never wrote to at all
 * (that UI manages a list in attendance_config.ipWhitelist, a different key
 * entirely) — so for any company only ever using the real UI, `cidr` was
 * always empty and this silently no-opped, allowing check-in from anywhere
 * despite the toggle being on. Now reads the real ip_whitelist table
 * (Section A) — multi-branch, "a match against ANY active entry is
 * sufficient" — and is also exactly what Section D's beacons write into.
 */
const assertOfficeIpAllowed = async (clientIp, companyId = null, clientIps = null) => {
  const { ok } = await isOfficeIpAllowed(clientIp, companyId, clientIps);
  if (!ok) {
    throw new ForbiddenError("Check-in is restricted to your office network. Contact HR if you're working remotely today.");
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

/** Any attendance record for the employee's current shift-day window (anchored to their assigned shift start, not midnight). */
const getTodayAttendance = async (employeeId, shiftStart = '09:30') => {
  const { windowStart, windowEnd } = getShiftDayWindow(nowIST(), shiftStart);

  const { data } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in_time', windowStart.toISOString())
    .lte('check_in_time', windowEnd.toISOString())
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
    // Late-arrival grace (existing, unrelated concept — how late you can
    // check in before being marked 'late').
    gracePeriodMinutes: Number(cfg.gracePeriodMinutes ?? cfg.grace_period_minutes ?? 15),
    // New, separate concept: how long past shift end to wait before a
    // biometric session's checkout/status becomes visible at all (see
    // recomputeBiometricWindow below). Company-wide — shifts have no edit
    // UI today, so a per-shift override isn't implementable cleanly yet.
    checkoutGracePeriodMinutes: Number(cfg.checkoutGracePeriodMinutes ?? cfg.checkout_grace_period_minutes ?? 30),
    // % of shift duration below which a finalized/provisional biometric day
    // is 'half_day' rather than 'early_departure'. Default 50 matches the
    // previously-hardcoded WORK_HOURS/2 threshold used elsewhere.
    halfDayThresholdPercent: Number(cfg.halfDayThresholdPercent ?? cfg.half_day_threshold_percent ?? 50),
    overtimeAfterHours: Number(cfg.overtimeAfterHours ?? cfg.overtime_after_hours ?? WORK_HOURS),
    shifts: Array.isArray(cfg.shifts) ? cfg.shifts : [],
    // Section E: company-level operational toggles (distinct from platform
    // entitlement, checked separately via featureOverrideService.hasFeature).
    // Default OFF: a company that has never touched geofencing (no explicit
    // opt-in, possibly zero geofences configured) must not suddenly get a
    // GPS permission prompt on every check-in just because gps_geofence is
    // baseline-entitled on their plan. Entitlement (can use it) and this
    // flag (has chosen to enforce it) are deliberately separate.
    gpsGeofenceEnabled: Boolean(cfg.gpsGeofenceEnabled ?? cfg.gps_geofence_enabled ?? false),
    requireBothLocationChecks: Boolean(cfg.requireBothLocationChecks ?? cfg.require_both_location_checks ?? false),
  };
};

/** The employee's assigned shift start time ("HH:mm"), or the default 09:30 if none is assigned/found. */
const resolveShiftStart = (employeeAddress, shifts) => {
  const addr = (employeeAddress && typeof employeeAddress === 'object') ? employeeAddress : {};
  const shiftId = addr.shift_id || addr.shiftId;
  const shiftName = addr.shift;
  if (!shiftId && !shiftName) return '09:30';
  const matched = (shifts || []).find((s) => (shiftId && s.id === shiftId) || (shiftName && s.name === shiftName));
  return matched?.start || '09:30';
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
  const shiftStart = resolveShiftStart(emp?.address, attendanceConfig.shifts);
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

  // Sections C+E: Office-mode, non-WFH, non-biometric check-ins are subject
  // to IP whitelist and/or GPS geofence, gated by BOTH entitlement
  // (company_feature_overrides via hasFeature) and the company's own
  // attendance_config toggle — entitlement decides whether the toggle is
  // even usable at all, the toggle decides whether it's actually required
  // day to day. Default OR (either sufficient) unless requireBothLocationChecks
  // is explicitly turned on — see Section E's report for this choice.
  const isBiometric = normalizedMethod === 'biometric';
  if (attendanceMode === 'office' && !wantsWfh && !isPrivilegedRole && !isBiometric) {
    const featureOverrideService = require('./featureOverride.service');
    const geofenceService = require('./geofence.service');
    const [ipWebEntitled, gpsEntitled] = await Promise.all([
      featureOverrideService.hasFeature(companyId, 'ip_based_web'),
      featureOverrideService.hasFeature(companyId, 'gps_geofence'),
    ]);
    const ipWebOn = ipWebEntitled && attendanceConfig.methods.ipWeb !== false;
    const gpsOn = gpsEntitled && attendanceConfig.gpsGeofenceEnabled === true;
    const requireBoth = attendanceConfig.requireBothLocationChecks === true;

    if (ipWebOn && gpsOn) {
      const [ipResult, gpsResult] = await Promise.all([
        isOfficeIpAllowed(clientIp, companyId, clientIps),
        geofenceService.isWithinAnyGeofence(companyId, location?.latitude, location?.longitude),
      ]);
      if (requireBoth) {
        if (!ipResult.ok) throw new ForbiddenError("Check-in is restricted to your office network. Contact HR if you're working remotely today.");
        if (!gpsResult.ok) {
          throw new ForbiddenError(gpsResult.reason === 'no_location'
            ? 'Location is required for check-in at this company. Please allow location access and try again.'
            : "You're outside your office location. Check-in requires you to be at one of your company's approved locations.");
        }
      } else if (!ipResult.ok && !gpsResult.ok) {
        throw new ForbiddenError("Check-in is restricted to your office network or one of your company's approved locations. Contact HR if you're working remotely today.");
      }
    } else if (ipWebOn) {
      await assertOfficeIpAllowed(clientIp, companyId, clientIps);
    } else if (gpsOn) {
      await geofenceService.assertWithinGeofence(companyId, location?.latitude, location?.longitude);
    }
  }

  const todayRecord = await getTodayAttendance(employeeId, shiftStart);
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
    company_id: companyId,
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

const checkOut = async (employeeId, { method, clientIp, break_minutes = 0, location } = {}) => {
  // Payroll rule (admin toggle): if checkout before goal hours, treat as half-day (not early_departure)
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const { data: empRow } = await supabaseAdmin.from('employees').select('address, role').eq('id', employeeId).maybeSingle();
  const companyId = empRow ? getCompanyId(empRow) : DEFAULT_COMPANY_ID;
  const attendanceConfig = await getAttendanceConfig(companyId);
  const shiftStart = resolveShiftStart(empRow?.address, attendanceConfig.shifts);

  const todayRecord = await getTodayAttendance(employeeId, shiftStart);
  if (todayRecord?.check_out_time) {
    throw new ConflictError('You have already checked out today. Only one check-out per day is allowed.');
  }

  const active = await getActiveCheckIn(employeeId);
  if (!active) throw new BadRequestError('No active check-in found for today');

  const checkOutTime = nowIST().toISOString();
  const totalHours = calculateWorkingHours(active.check_in_time, checkOutTime) - (break_minutes / 60);
  const wasWfh = active.status === 'wfh' || isWfhLocation(active.location);

  // Section E: geofence also applies at checkout, for the same Office/
  // non-WFH/non-biometric population as check-in. IP whitelist is
  // deliberately NOT re-checked here — Section C scopes that to check-in only.
  const isPrivilegedRole = ['admin', 'hr'].includes(empRow?.role);
  const isBiometricCheckout = (method || active.check_in_method) === 'biometric';
  if (!wasWfh && !isPrivilegedRole && !isBiometricCheckout) {
    const featureOverrideService = require('./featureOverride.service');
    const geofenceService = require('./geofence.service');
    const gpsEntitled = await featureOverrideService.hasFeature(companyId, 'gps_geofence');
    const gpsOn = gpsEntitled && attendanceConfig.gpsGeofenceEnabled === true;
    if (gpsOn) {
      await geofenceService.assertWithinGeofence(companyId, location?.latitude, location?.longitude);
    }
  }

  const overtimeHours = Math.max(0, totalHours - attendanceConfig.overtimeAfterHours);
  let status = determineAttendanceStatus(active.check_in_time, totalHours, attendanceConfig.gracePeriodMinutes, shiftStart);
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
  const { employee_code, action, device_id, company_id } = payload;
  if (!company_id) throw new BadRequestError('company_id is required');
  const { data: employee, error } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('employee_code', employee_code)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!employee) throw new NotFoundError('Employee not found');

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

/** Create the day's attendance record, or correct it if one already exists (regularization). */
const manualEntry = async (hrUserId, data) => {
  const { employee_id, check_in_time, check_out_time, remarks, break_minutes = 0 } = data;

  // Audit finding N-03: employee_id came straight from the request body
  // with no check against the calling HR/Admin's own id — blocked outright
  // rather than requiring a countersignature, since no such pattern exists
  // elsewhere in this codebase to reuse.
  if (employee_id === hrUserId) {
    throw new ForbiddenError('You cannot manually edit your own attendance record');
  }

  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const { data: empRow } = await supabaseAdmin.from('employees').select('address').eq('id', employee_id).maybeSingle();
  const companyId = empRow ? getCompanyId(empRow) : DEFAULT_COMPANY_ID;
  const attendanceConfig = await getAttendanceConfig(companyId);
  const shiftStart = resolveShiftStart(empRow?.address, attendanceConfig.shifts);

  const { windowStart, windowEnd } = getShiftDayWindow(moment(check_in_time).tz(TIMEZONE), shiftStart);
  const { data: existing } = await supabaseAdmin
    .from('attendance')
    .select('id')
    .eq('employee_id', employee_id)
    .gte('check_in_time', windowStart.toISOString())
    .lte('check_in_time', windowEnd.toISOString())
    .limit(1)
    .maybeSingle();

  const totalHours = check_out_time
    ? calculateWorkingHours(check_in_time, check_out_time) - (break_minutes / 60)
    : null;

  // edited_by is the authoritative audit field for who made this manual
  // change — set server-side from hrUserId (never from the request body).
  // remarks stays as a free-text note, but it's no longer the only record
  // of who touched the row: a caller who overwrites remarks can no longer
  // erase the trail.
  const payload = {
    employee_id,
    company_id: companyId,
    edited_by: hrUserId,
    check_in_time,
    check_out_time,
    check_in_method: 'web',
    check_out_method: check_out_time ? 'web' : null,
    break_minutes,
    total_hours: totalHours ? Math.round(totalHours * 100) / 100 : null,
    overtime_hours: totalHours ? Math.max(0, Math.round((totalHours - attendanceConfig.overtimeAfterHours) * 100) / 100) : 0,
    status: totalHours ? determineAttendanceStatus(check_in_time, totalHours, attendanceConfig.gracePeriodMinutes, shiftStart) : 'present',
    remarks: remarks || `Manual entry by HR (${hrUserId})`,
  };

  const runWrite = (body) => (existing
    ? supabaseAdmin.from('attendance').update({ ...body, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single()
    : supabaseAdmin.from('attendance').insert(body).select().single());

  let { data: record, error } = await runWrite(payload);

  if (error && /column .*edited_by.* does not exist/i.test(error.message || '')) {
    // Migration 20260829_attendance_audit_columns.sql not applied yet in
    // this environment — fall back to the pre-audit-column behavior rather
    // than hard-failing every manual entry.
    const { edited_by, ...withoutEditedBy } = payload;
    ({ data: record, error } = await runWrite(withoutEditedBy));
  }

  if (error) throw new BadRequestError(error.message);
  return record;
};

/**
 * Date-only strings become full IST day bounds so same-day filters work.
 * This listing spans many employees at once (unlike getMonthlySummary/
 * getRangeSummary, which are per-employee and can anchor exactly to that
 * one employee's shift), so there's no single shift to anchor against
 * before the query runs. Pad the boundary by a few hours instead — a
 * night-shift employee's shift-anchored day can start well before local
 * midnight, so a plain midnight cutoff would silently exclude their
 * records; erring toward including a little extra is the safer direction
 * for an admin review list than silently dropping legitimate rows.
 */
const SHIFT_BOUNDARY_PADDING_HOURS = 2;

const toRangeStart = (value) => {
  if (!value) return null;
  if (String(value).includes('T')) return moment(value).toISOString();
  return moment.tz(value, TIMEZONE).startOf('day').subtract(SHIFT_BOUNDARY_PADDING_HOURS, 'hours').toISOString();
};

const toRangeEnd = (value) => {
  if (!value) return null;
  if (String(value).includes('T')) return moment(value).toISOString();
  return moment.tz(value, TIMEZONE).endOf('day').add(SHIFT_BOUNDARY_PADDING_HOURS, 'hours').toISOString();
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
  // A biometric row that hasn't finalized yet (checkout_status defaults to
  // 'finalized' on every non-biometric row) has a status/total_hours that
  // can still change — LOP/payroll (this function feeds payroll.service.js's
  // LOP calc directly) must never treat a provisional value as authoritative.
  // Falls through to the same "still open, counts as present-in-progress"
  // treatment a 'pending' row already gets via `!a.check_out_time` below.
  const isFinal = (a) => !a.checkout_status || a.checkout_status === 'finalized';
  // Present = office days showed up (on-time, late, or left early). WFH counted separately.
  const present = rows.filter((a) =>
    !rowIsWfh(a) && ((isFinal(a) && ['present', 'late', 'early_departure'].includes(a.status)) || !isFinal(a) || !a.check_out_time)
  ).length;
  const late = rows.filter((a) => isFinal(a) && a.status === 'late' && !rowIsWfh(a)).length;
  const halfDay = rows.filter((a) => isFinal(a) && a.status === 'half_day').length;
  const earlyDeparture = rows.filter((a) => isFinal(a) && a.status === 'early_departure').length;
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
  // Bucket each record by its shift-anchored day (the same day the record was
  // actually created/looked-up under), not the raw calendar date of the
  // check-in instant — otherwise a night-shift employee whose check-in lands
  // just after local midnight gets counted a day late here despite every
  // write path already anchoring it correctly.
  const shiftStart = await getEmployeeShiftStart(employeeId);
  const attendedDays = new Set(
    rows.map((a) => getShiftDayWindow(moment(a.check_in_time).tz(TIMEZONE), shiftStart).windowStart.format('YYYY-MM-DD'))
  );

  // Days covered by HR-approved leave must not be counted as absent (they
  // already feed loss-of-pay through the LOP calc, not the AWOL "absent" bucket).
  // UNPAID leave is excluded from this carve-out: by definition it should still
  // dock pay, so those days stay counted as absent for the LOP calc downstream.
  const { data: approvedLeaves, error: leavesError } = await supabaseAdmin
    .from('leaves')
    .select('from_date, to_date, leave_type')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('from_date', end.format('YYYY-MM-DD'))
    .gte('to_date', start.format('YYYY-MM-DD'));
  if (leavesError) throw new BadRequestError(leavesError.message);

  const approvedLeaveDays = new Set();
  for (const lv of approvedLeaves || []) {
    if (lv.leave_type === 'UNPAID') continue;
    const leaveFrom = moment.tz(lv.from_date, TIMEZONE).startOf('day');
    const leaveTo = moment.tz(lv.to_date, TIMEZONE).startOf('day');
    const rangeStart = moment.max(leaveFrom, start);
    const rangeEnd = moment.min(leaveTo, end);
    const leaveCursor = rangeStart.clone();
    while (leaveCursor.isSameOrBefore(rangeEnd, 'day')) {
      approvedLeaveDays.add(leaveCursor.format('YYYY-MM-DD'));
      leaveCursor.add(1, 'day');
    }
  }

  const today = nowIST();
  const cutoff = today.isBefore(end) ? today.clone().startOf('day') : end.clone();
  let absent = 0;
  const absCursor = start.clone();
  while (absCursor.isSameOrBefore(cutoff, 'day')) {
    const dow = absCursor.day();
    const key = absCursor.format('YYYY-MM-DD');
    if (dow !== 0 && dow !== 6 && !attendedDays.has(key) && !approvedLeaveDays.has(key)) absent += 1;
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
    onApprovedLeave: approvedLeaveDays.size,
    totalHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    avgHours: daysWithHours ? Math.round((totalHours / daysWithHours) * 10) / 10 : 0,
    incomplete,
  };

  return { records: rows, summary };
};

/**
 * Same aggregation as getMonthlySummary (present/absent/late/half-day/leave-days,
 * total + overtime hours, incl. the approved-leave-excludes-absent carve-out) but
 * over an arbitrary [from, to] date range instead of a calendar month — used by
 * the Attendance Summary report, which takes a free date range rather than month/year.
 */
const getRangeSummary = async (employeeId, fromDate, toDate) => {
  const start = moment.tz(fromDate, TIMEZONE).startOf('day');
  const end = moment.tz(toDate, TIMEZONE).endOf('day');

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('check_in_time', start.toISOString())
    .lte('check_in_time', end.toISOString());

  if (error) throw new BadRequestError(error.message);

  const rows = data || [];
  const rowIsWfh = (a) => a.status === 'wfh' || isWfhLocation(a.location);
  // Same finalized-only gate as getMonthlySummary — see its comment.
  const isFinal = (a) => !a.checkout_status || a.checkout_status === 'finalized';
  const present = rows.filter((a) =>
    !rowIsWfh(a) && ((isFinal(a) && ['present', 'late', 'early_departure'].includes(a.status)) || !isFinal(a) || !a.check_out_time)
  ).length;
  const late = rows.filter((a) => isFinal(a) && a.status === 'late' && !rowIsWfh(a)).length;
  const halfDay = rows.filter((a) => isFinal(a) && a.status === 'half_day').length;
  const earlyDeparture = rows.filter((a) => isFinal(a) && a.status === 'early_departure').length;
  const totalHours = rows.reduce((sum, a) => sum + (parseFloat(a.total_hours) || 0), 0);
  const overtimeHours = rows.reduce((sum, a) => sum + (parseFloat(a.overtime_hours) || 0), 0);

  let workingDays = 0;
  const cursor = start.clone();
  while (cursor.isSameOrBefore(end, 'day')) {
    const dow = cursor.day();
    if (dow !== 0 && dow !== 6) workingDays += 1;
    cursor.add(1, 'day');
  }
  // Same shift-anchored bucketing as getMonthlySummary — see its comment.
  const shiftStart = await getEmployeeShiftStart(employeeId);
  const attendedDays = new Set(
    rows.map((a) => getShiftDayWindow(moment(a.check_in_time).tz(TIMEZONE), shiftStart).windowStart.format('YYYY-MM-DD'))
  );

  // Same carve-out as getMonthlySummary: HR-approved (non-UNPAID) leave days are
  // "on leave", not "absent" — UNPAID stays counted as absent for LOP purposes.
  const { data: approvedLeaves, error: leavesError } = await supabaseAdmin
    .from('leaves')
    .select('from_date, to_date, leave_type')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('from_date', end.format('YYYY-MM-DD'))
    .gte('to_date', start.format('YYYY-MM-DD'));
  if (leavesError) throw new BadRequestError(leavesError.message);

  const approvedLeaveDays = new Set();
  for (const lv of approvedLeaves || []) {
    if (lv.leave_type === 'UNPAID') continue;
    const leaveFrom = moment.tz(lv.from_date, TIMEZONE).startOf('day');
    const leaveTo = moment.tz(lv.to_date, TIMEZONE).startOf('day');
    const rangeStart = moment.max(leaveFrom, start);
    const rangeEnd = moment.min(leaveTo, end);
    const leaveCursor = rangeStart.clone();
    while (leaveCursor.isSameOrBefore(rangeEnd, 'day')) {
      approvedLeaveDays.add(leaveCursor.format('YYYY-MM-DD'));
      leaveCursor.add(1, 'day');
    }
  }

  const today = nowIST();
  const cutoff = today.isBefore(end) ? today.clone().startOf('day') : end.clone();
  let absent = 0;
  const absCursor = start.clone();
  while (absCursor.isSameOrBefore(cutoff, 'day')) {
    const dow = absCursor.day();
    const key = absCursor.format('YYYY-MM-DD');
    if (dow !== 0 && dow !== 6 && !attendedDays.has(key) && !approvedLeaveDays.has(key)) absent += 1;
    absCursor.add(1, 'day');
  }

  return {
    workingDays,
    present,
    wfh: rows.filter((a) => rowIsWfh(a)).length,
    late,
    halfDay,
    earlyDeparture,
    absent,
    leaveDays: approvedLeaveDays.size,
    totalHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
  };
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
  const attendanceConfigByCompany = new Map();
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
    if (!attendanceConfigByCompany.has(companyId)) {
      // eslint-disable-next-line no-await-in-loop
      attendanceConfigByCompany.set(companyId, await getAttendanceConfig(companyId));
    }
    const halfDayBeforeGoal = halfDayBeforeGoalByCompany.get(companyId);
    const attendanceConfig = attendanceConfigByCompany.get(companyId);
    const shiftStart = resolveShiftStart(record.employee?.address, attendanceConfig.shifts);

    const checkoutIso = deadline.toISOString();
    const totalHours = calculateWorkingHours(record.check_in_time, checkoutIso);
    let status = determineAttendanceStatus(record.check_in_time, totalHours, attendanceConfig.gracePeriodMinutes, shiftStart);

    if (halfDayBeforeGoal && totalHours < WORK_HOURS && totalHours > 0) {
      status = 'half_day';
    }

    await supabaseAdmin
      .from('attendance')
      .update({
        check_out_time: checkoutIso,
        check_out_method: record.check_in_method,
        total_hours: Math.round(totalHours * 100) / 100,
        overtime_hours: Math.max(0, Math.round((totalHours - attendanceConfig.overtimeAfterHours) * 100) / 100),
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

/** The employee's assigned shift start ("HH:mm"), resolved from their address + company config. */
const getEmployeeShiftStart = async (employeeId) => {
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const { data: empRow } = await supabaseAdmin.from('employees').select('address').eq('id', employeeId).maybeSingle();
  const companyId = empRow ? getCompanyId(empRow) : DEFAULT_COMPANY_ID;
  const attendanceConfig = await getAttendanceConfig(companyId);
  return resolveShiftStart(empRow?.address, attendanceConfig.shifts);
};

/**
 * Status tiers mirror determineAttendanceStatus's exact structure (half_day
 * / early_departure / late / present — see attendance.service.js audit,
 * this codebase already has 4 tiers, not 2) but parameterized by THIS
 * shift's own duration (attendanceAnomaly.service.js's resolveExpectedHours
 * — end-minus-start, midnight-wrapping, WORK_HOURS fallback) and the new
 * configurable half-day threshold %, instead of the flat WORK_HOURS
 * constant determineAttendanceStatus uses. Kept separate from
 * determineAttendanceStatus deliberately — that function is still used
 * as-is by web/manual/office_ip check-in/out, untouched by this rework.
 */
const evaluateBiometricStatus = (checkInTime, totalHours, shiftStart, gracePeriodMinutes, expectedHours, halfDayThresholdPercent) => {
  const checkInMoment = moment(checkInTime).tz(TIMEZONE);
  const { windowStart } = getShiftDayWindow(checkInMoment, shiftStart);
  const isLate = checkInMoment.isAfter(windowStart.clone().add(gracePeriodMinutes, 'minutes'));
  const halfDayThresholdHours = expectedHours * (halfDayThresholdPercent / 100);
  if (totalHours < halfDayThresholdHours) return 'half_day';
  if (totalHours < expectedHours) return 'early_departure';
  if (isLate) return 'late';
  return 'present';
};

/**
 * THE shared recomputation function for biometric attendance — triggered on
 * every incoming punch (adms.service.js) AND by the periodic transition job
 * below (for pending→provisional and provisional→finalized transitions that
 * happen purely from time passing, with no new punch to trigger them) AND
 * on-demand from checkContext (attendance.controller.js) so an employee's
 * own live view is never stale on page load either.
 *
 * Lifecycle (checkout_status): pending → provisional → finalized.
 *  - pending: before (shift end + checkout grace period). No checkout, no
 *    status shown anywhere — only "checked in, in progress."
 *  - provisional: grace period has passed, window hasn't closed yet.
 *    checkout = the LATEST punch so far, status freshly evaluated from
 *    that — both update again on every new punch, never independently.
 *  - finalized: the shift's 24h window (getShiftDayWindow, unchanged) has
 *    closed. Checkout + status lock as they stand at that instant. This
 *    function becomes a no-op once finalized — it never un-finalizes a row,
 *    and a punch arriving after window close belongs to the NEXT window's
 *    windowStartIso, so it's a new cycle, never touches this one.
 *
 * Never overwrites a record already created by a different check-in method
 * (web/office_ip/manual) — an employee only ever has one attendance path
 * per day. Unchanged from the prior implementation.
 */
const recomputeBiometricWindow = async (employeeId, windowStartIso) => {
  const windowStart = moment(windowStartIso).tz(TIMEZONE);
  const windowEnd = windowStart.clone().add(1, 'day');

  const { data: existing } = await supabaseAdmin
    .from('attendance')
    .select('id, check_in_method, checkout_status')
    .eq('employee_id', employeeId)
    .gte('check_in_time', windowStart.toISOString())
    .lte('check_in_time', windowEnd.toISOString())
    .limit(1)
    .maybeSingle();

  if (existing && existing.check_in_method !== 'biometric') return;
  // A finalized row is locked — never re-evaluated, regardless of what
  // triggered this call (late-arriving punch, periodic job re-scan, etc).
  if (existing && existing.checkout_status === 'finalized') return;

  const { data: punches, error: punchesError } = await supabaseAdmin
    .from('device_punches')
    .select('punch_time')
    .eq('employee_id', employeeId)
    .gte('punch_time', windowStart.toISOString())
    .lte('punch_time', windowEnd.toISOString())
    .order('punch_time', { ascending: true });

  if (punchesError || !punches?.length) return;

  const checkInTime = punches[0].punch_time;
  const latestPunchTime = punches[punches.length - 1].punch_time;

  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const { data: empRow } = await supabaseAdmin.from('employees').select('address').eq('id', employeeId).maybeSingle();
  const companyId = empRow ? getCompanyId(empRow) : DEFAULT_COMPANY_ID;
  const attendanceConfig = await getAttendanceConfig(companyId);

  // Security audit finding: savePunches()'s data_collection_mode check
  // (adms.service.js) is NOT actually an entitlement gate — getDataCollectionMode
  // defaults to 'continue' whenever no super-admin override row exists, so a
  // company whose plan simply never included biometric_adms (no override
  // ever set) sailed straight through it. The real entitlement was never
  // checked anywhere on this ingestion path. Checked here, alongside the
  // company's own methods.biometric toggle — savePunches() still logs the
  // raw device_punches row either way (audit trail), but punches only ever
  // get promoted into `attendance` when both the plan entitlement AND the
  // company's own toggle allow it. Never touches an existing non-biometric
  // record either way (unchanged).
  const featureOverrideService = require('./featureOverride.service');
  const biometricEntitled = await featureOverrideService.hasFeature(companyId, 'biometric_adms');
  if (!biometricEntitled || attendanceConfig.methods.biometric === false) return;

  const { resolveShift, resolveExpectedHours } = require('./attendanceAnomaly.service');
  const shiftStart = resolveShiftStart(empRow?.address, attendanceConfig.shifts);
  const shift = resolveShift(empRow?.address, attendanceConfig.shifts);
  const expectedHours = resolveExpectedHours(shift);

  const now = nowIST();
  const shiftEnd = windowStart.clone().add(expectedHours, 'hours');
  const graceDeadline = shiftEnd.clone().add(attendanceConfig.checkoutGracePeriodMinutes, 'minutes');

  let payload;
  if (now.isBefore(graceDeadline)) {
    // Still within grace — nothing visible yet, but every punch is still
    // recorded (in device_punches, already done by the caller) and
    // last_punch_at stays in sync for internal computation.
    payload = {
      employee_id: employeeId,
      company_id: companyId,
      check_in_time: checkInTime,
      check_out_time: null,
      check_in_method: 'biometric',
      check_out_method: null,
      total_hours: null,
      overtime_hours: 0,
      status: 'present', // placeholder while open — matches the existing convention for any open session (see getMonthlySummary's `!check_out_time` fallback), never read as authoritative while checkout_status='pending'
      checkout_status: 'pending',
      last_punch_at: latestPunchTime,
    };
  } else {
    const totalHours = calculateWorkingHours(checkInTime, latestPunchTime);
    const status = evaluateBiometricStatus(
      checkInTime, totalHours, shiftStart,
      attendanceConfig.gracePeriodMinutes, expectedHours, attendanceConfig.halfDayThresholdPercent
    );
    payload = {
      employee_id: employeeId,
      company_id: companyId,
      check_in_time: checkInTime,
      check_out_time: latestPunchTime,
      check_in_method: 'biometric',
      check_out_method: 'biometric',
      total_hours: Math.round(totalHours * 100) / 100,
      overtime_hours: Math.max(0, Math.round((totalHours - attendanceConfig.overtimeAfterHours) * 100) / 100),
      status,
      // Only now, at (or after) window close, does this lock permanently.
      checkout_status: now.isSameOrAfter(windowEnd) ? 'finalized' : 'provisional',
      last_punch_at: latestPunchTime,
    };
  }

  const { error } = existing
    ? await supabaseAdmin.from('attendance').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id)
    : await supabaseAdmin.from('attendance').insert(payload);

  if (error) {
    logger.error('[ADMS] Failed to recompute biometric attendance window', { employeeId, windowStartIso, error: error.message });
  }
};

/**
 * Periodic sweep (see biometricWindowTransition.cron.js) — transitions
 * pending→provisional and provisional→finalized purely from time passing,
 * for windows where no new punch has arrived to trigger recomputeBiometricWindow
 * naturally. Without this, an employee who scans once and never again would
 * stay 'pending' ("in progress") forever — this is what actually resolves
 * that case now (replacing the old fixed-4AM job for biometric specifically;
 * see the investigation note on why that job's fixed clock doesn't line up
 * with arbitrary shift-anchored windows).
 */
const transitionPendingBiometricWindows = async () => {
  const { data: rows, error } = await supabaseAdmin
    .from('attendance')
    .select('employee_id, check_in_time')
    .eq('check_in_method', 'biometric')
    .in('checkout_status', ['pending', 'provisional']);

  if (error) {
    logger.error('[ADMS] Failed to fetch pending/provisional biometric windows', { error: error.message });
    return { processed: 0 };
  }

  let processed = 0;
  for (const row of rows || []) {
    const shiftStart = await getEmployeeShiftStart(row.employee_id).catch(() => '09:30');
    // eslint-disable-next-line no-await-in-loop
    const { windowStart } = getShiftDayWindow(moment(row.check_in_time).tz(TIMEZONE), shiftStart);
    // eslint-disable-next-line no-await-in-loop
    await recomputeBiometricWindow(row.employee_id, windowStart.toISOString()).catch((err) => {
      logger.error('[ADMS] Periodic transition failed', { employeeId: row.employee_id, error: err.message });
    });
    processed++;
  }
  return { processed };
};

/**
 * On-demand/lazy recompute for one employee's CURRENT window — called from
 * checkContext (attendance.controller.js) on every page load of My
 * Attendance, so a pending→provisional transition (or a provisional
 * value's update) is visible immediately even if the 15-minute periodic
 * sweep hasn't ticked yet. Cheap (one employee, current window only) —
 * deliberately not run per-employee from the HR Team Attendance list,
 * which relies on the periodic sweep + short frontend polling instead.
 * A no-op if there's no biometric row/punches for the current window
 * (recomputeBiometricWindow itself no-ops in that case).
 */
const recomputeCurrentBiometricWindow = async (employeeId) => {
  const shiftStart = await getEmployeeShiftStart(employeeId).catch(() => '09:30');
  const { windowStart } = getShiftDayWindow(nowIST(), shiftStart);
  await recomputeBiometricWindow(employeeId, windowStart.toISOString()).catch((err) => {
    logger.error('[ADMS] On-demand recompute failed', { employeeId, error: err.message });
  });
};

/**
 * A team member's manager_id has no cross-company constraint at the DB level
 * — the companyId filter defends against a manager_id that somehow points
 * outside the manager's own company (data-entry error, a company
 * reassignment gone wrong) leaking that employee's data into every
 * consumer of "my team" (payroll/reimbursement approvals, attendance,
 * leave, reports). companyId is REQUIRED, not optional: every consumer of
 * this helper either adds its own downstream company check or exposes
 * lower-sensitivity data, so a caller that forgets to pass it is exactly
 * the bug this boundary exists to catch (see Payroll Summary, which had
 * nothing else catching a cross-company manager_id before this). Failing
 * loud here means a missing companyId breaks that one caller immediately
 * and visibly, instead of silently returning every manager's team
 * platform-wide.
 */
const getTeamEmployeeIds = async (managerId, companyId) => {
  if (!companyId) throw new BadRequestError('companyId is required to resolve a manager\'s team');
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
    .eq('is_active', true)
    .eq('company_id', companyId);
  return (data || []).map((e) => e.id);
};

/**
 * Item 8: rows written by recomputeBiometricWindow always carry
 * check_in_method/check_out_method = 'biometric' (see that function above).
 * This is the ONE place that predicate lives, reused everywhere a
 * COMPANY-FACING display needs to hide biometric-sourced rows.
 *
 * Deliberately NOT wired into getAttendance/getMonthlySummary/getRangeSummary
 * themselves — those are shared by both display controllers (attendance.controller.js)
 * AND business logic (payroll.service.js's LOP calc, attendanceAnomaly.service.js).
 * Filtering happens one layer up, in the controllers, so every internal/
 * automated caller of these service functions keeps seeing complete,
 * unfiltered data — only the HTTP response layer for company-facing routes
 * ever strips rows. See attendance.controller.js for where this is applied.
 */
const isBiometricRow = (row) => row.check_in_method === 'biometric' || row.check_out_method === 'biometric';
const stripBiometricRows = (rows) => (rows || []).filter((r) => !isBiometricRow(r));

module.exports = {
  checkIn,
  checkOut,
  biometricWebhook,
  manualEntry,
  getAttendance,
  getMonthlySummary,
  getRangeSummary,
  processAutoCheckout,
  getTeamEmployeeIds,
  getActiveCheckIn,
  getTodayAttendance,
  getAttendanceConfig,
  normalizeCheckInMethod,
  recomputeBiometricWindow,
  transitionPendingBiometricWindows,
  recomputeCurrentBiometricWindow,
  getEmployeeShiftStart,
  resolveShiftStart,
  isBiometricRow,
  stripBiometricRows,
  isOfficeIpAllowed,
};
