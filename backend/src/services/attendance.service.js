const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const { TIMEZONE, WORK_HOURS } = require('../utils/constants');
const {
  BadRequestError, NotFoundError, ConflictError,
} = require('../utils/errors');
const {
  calculateWorkingHours, determineAttendanceStatus, nowIST, paginate, buildMeta,
} = require('../utils/helpers');
const { autoCheckoutEmail } = require('./email.service');
const logger = require('../utils/logger');

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

const checkIn = async (employeeId, { method, device_id, location, clientIp }) => {
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

  const { data, error } = await supabaseAdmin
    .from('attendance')
    .insert({
      employee_id: employeeId,
      check_in_time: nowIST().toISOString(),
      check_in_method: method,
      check_in_ip: clientIp,
      device_id,
      location,
      status: 'present',
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  logger.info('Check-in recorded', { employeeId, method });
  return data;
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
  const status = determineAttendanceStatus(active.check_in_time, totalHours);

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
  const { employee_code, action, timestamp, device_id } = payload;
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('employee_code', employee_code)
    .single();

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

const getAttendance = async (filters, query) => {
  const { page, limit, offset } = paginate(query);
  let dbQuery = supabaseAdmin
    .from('attendance')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department)', { count: 'exact' })
    .order('check_in_time', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.employee_id) dbQuery = dbQuery.eq('employee_id', filters.employee_id);
  if (filters.employee_ids) dbQuery = dbQuery.in('employee_id', filters.employee_ids);
  if (filters.from) dbQuery = dbQuery.gte('check_in_time', filters.from);
  if (filters.to) dbQuery = dbQuery.lte('check_in_time', filters.to);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data, meta: buildMeta(page, limit, count) };
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

  const summary = {
    totalDays: data.length,
    present: data.filter((a) => a.status === 'present').length,
    late: data.filter((a) => a.status === 'late').length,
    halfDay: data.filter((a) => a.status === 'half_day').length,
    earlyDeparture: data.filter((a) => a.status === 'early_departure').length,
    totalHours: data.reduce((sum, a) => sum + (parseFloat(a.total_hours) || 0), 0),
    overtimeHours: data.reduce((sum, a) => sum + (parseFloat(a.overtime_hours) || 0), 0),
    incomplete: data.filter((a) => !a.check_out_time).length,
  };

  return { records: data, summary };
};

const processAutoCheckout = async () => {
  const checkoutTime = nowIST().hour(4).minute(0).second(0);

  const { data: activeRecords, error } = await supabaseAdmin
    .from('attendance')
    .select('*, employee:employee_id(id, email, first_name, last_name)')
    .is('check_out_time', null);

  if (error) {
    logger.error('Auto checkout fetch failed', { error: error.message });
    return { processed: 0 };
  }

  let processed = 0;
  for (const record of activeRecords || []) {
    const totalHours = calculateWorkingHours(record.check_in_time, checkoutTime.toISOString());
    const status = determineAttendanceStatus(record.check_in_time, totalHours);

    await supabaseAdmin
      .from('attendance')
      .update({
        check_out_time: checkoutTime.toISOString(),
        check_out_method: record.check_in_method,
        total_hours: Math.round(totalHours * 100) / 100,
        overtime_hours: Math.max(0, Math.round((totalHours - WORK_HOURS) * 100) / 100),
        status,
        is_auto_checkout: true,
        remarks: 'auto_checkout',
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
};
