const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { TIMEZONE } = require('../utils/constants');
const {
  BadRequestError, NotFoundError, ForbiddenError,
} = require('../utils/errors');
const { calculateLeaveDays, paginate, buildMeta } = require('../utils/helpers');
const { leaveStatusEmail } = require('./email.service');
const { getTeamEmployeeIds } = require('./attendance.service');
const logger = require('../utils/logger');

const applyLeave = async (employeeId, data) => {
  const { leave_type, from_date, to_date, is_half_day, reason } = data;

  if (moment(to_date).isBefore(from_date)) {
    throw new BadRequestError('To date must be after from date');
  }

  const totalDays = calculateLeaveDays(from_date, to_date, is_half_day);

  if (['CL', 'SL', 'EL'].includes(leave_type)) {
    const year = moment(from_date).year();
    const { data: balance } = await supabaseAdmin
      .from('leave_balances')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('year', year)
      .eq('leave_type', leave_type)
      .single();

    if (balance && (balance.total_allocated - balance.used) < totalDays) {
      throw new BadRequestError(`Insufficient ${leave_type} balance`);
    }
  }

  const { data: leave, error } = await supabaseAdmin
    .from('leaves')
    .insert({
      employee_id: employeeId,
      leave_type,
      from_date,
      to_date,
      total_days: totalDays,
      is_half_day: is_half_day || false,
      reason,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return leave;
};

const getLeaves = async (filters, query) => {
  const { page, limit, offset } = paginate(query);
  let dbQuery = supabaseAdmin
    .from('leaves')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.employee_id) dbQuery = dbQuery.eq('employee_id', filters.employee_id);
  if (filters.employee_ids) dbQuery = dbQuery.in('employee_id', filters.employee_ids);
  if (filters.status) dbQuery = dbQuery.eq('status', filters.status);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data, meta: buildMeta(page, limit, count) };
};

const approveLeave = async (approver, leaveId, isManagerApproval = false) => {
  const { data: leave } = await supabaseAdmin.from('leaves').select('*, employee:employee_id(*)').eq('id', leaveId).single();
  if (!leave) throw new NotFoundError('Leave not found');
  if (leave.status !== 'pending' && !(isManagerApproval && !leave.manager_approved_by)) {
    throw new BadRequestError('Leave cannot be approved in current status');
  }

  if (isManagerApproval && approver.role === 'manager') {
    const teamIds = await getTeamEmployeeIds(approver.id);
    if (!teamIds.includes(leave.employee_id)) {
      throw new ForbiddenError('Not authorized to approve this leave');
    }

    const { data: updated } = await supabaseAdmin
      .from('leaves')
      .update({
        manager_approved_by: approver.id,
        manager_approved_at: new Date().toISOString(),
      })
      .eq('id', leaveId)
      .select()
      .single();

    return updated;
  }

  // HR/Admin final approval (Manager → HR workflow)
  if (leave.employee?.manager_id && !leave.manager_approved_by) {
    throw new BadRequestError('Manager approval required before HR approval');
  }

  const { data: updated, error } = await supabaseAdmin
    .from('leaves')
    .update({
      status: 'approved',
      approved_by: approver.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', leaveId)
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);

  if (leave.employee) {
    leaveStatusEmail(leave.employee, leave, 'approved').catch(() => {});
  }
  return updated;
};

const rejectLeave = async (approver, leaveId, rejection_reason) => {
  const { data: leave } = await supabaseAdmin.from('leaves').select('*, employee:employee_id(*)').eq('id', leaveId).single();
  if (!leave) throw new NotFoundError('Leave not found');
  if (!['pending'].includes(leave.status)) {
    throw new BadRequestError('Leave cannot be rejected');
  }

  const { data: updated, error } = await supabaseAdmin
    .from('leaves')
    .update({
      status: 'rejected',
      approved_by: approver.id,
      approved_at: new Date().toISOString(),
      rejection_reason,
    })
    .eq('id', leaveId)
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  if (leave.employee) {
    leaveStatusEmail(leave.employee, leave, 'rejected', rejection_reason).catch(() => {});
  }
  return updated;
};

const cancelLeave = async (employeeId, leaveId) => {
  const { data: leave } = await supabaseAdmin.from('leaves').select('*').eq('id', leaveId).single();
  if (!leave) throw new NotFoundError('Leave not found');
  if (leave.employee_id !== employeeId) throw new ForbiddenError('Not authorized');
  if (!['pending', 'approved'].includes(leave.status)) {
    throw new BadRequestError('Leave cannot be cancelled');
  }

  const { data: updated, error } = await supabaseAdmin
    .from('leaves')
    .update({ status: 'cancelled' })
    .eq('id', leaveId)
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return updated;
};

const getLeaveBalance = async (employeeId, year) => {
  const targetYear = year || moment().year();
  const { data, error } = await supabaseAdmin
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('year', targetYear);

  if (error) throw new BadRequestError(error.message);

  return (data || []).map((b) => ({
    ...b,
    available: b.total_allocated - b.used - b.encashed,
  }));
};

const getLeaveCalendar = async (month, year) => {
  const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).format('YYYY-MM-DD');
  const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');

  const { data, error } = await supabaseAdmin
    .from('leaves')
    .select('*, employee:employee_id(first_name, last_name, department)')
    .eq('status', 'approved')
    .lte('from_date', end)
    .gte('to_date', start);

  if (error) throw new BadRequestError(error.message);
  return data;
};

const calculateEncashment = async (employeeId, leaveType, days) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('salary_details')
    .eq('id', employeeId)
    .single();

  const basic = employee?.salary_details?.basic || 0;
  const perDay = basic / 30;
  return Math.round(perDay * days * 100) / 100;
};

module.exports = {
  applyLeave,
  getLeaves,
  approveLeave,
  rejectLeave,
  cancelLeave,
  getLeaveBalance,
  getLeaveCalendar,
  calculateEncashment,
};
