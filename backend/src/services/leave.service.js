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
const settingsService = require('./settings.service');
const config = require('../config/database');
const { LEAVE_TYPES } = require('../utils/constants');
const notificationService = require('./notification.service');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');

const resolveEmployeeCompanyId = async (employeeId) => {
  const { data } = await supabaseAdmin
    .from('employees')
    .select('address')
    .eq('id', employeeId)
    .maybeSingle();
  return data ? getCompanyId(data) : DEFAULT_COMPANY_ID;
};

const defaultPolicy = (year) => ([
  { code: 'CL', name: 'Casual Leave', allocation: config.leaveBalances?.CL ?? 12, active: true },
  { code: 'SL', name: 'Sick Leave', allocation: config.leaveBalances?.SL ?? 12, active: true },
  { code: 'EL', name: 'Earned Leave', allocation: config.leaveBalances?.EL ?? 15, active: true },
  { code: 'WFH', name: 'Work From Home', allocation: 0, active: true },
  { code: 'COMP_OFF', name: 'Comp Off', allocation: 0, active: true },
  { code: 'MATERNITY', name: 'Maternity Leave', allocation: 0, active: true },
  { code: 'PATERNITY', name: 'Paternity Leave', allocation: 0, active: true },
  { code: 'UNPAID', name: 'Unpaid Leave', allocation: 0, active: true },
]);

const getEffectiveLeavePolicy = async (year, companyId = null) => {
  const cid = companyId || DEFAULT_COMPANY_ID;
  const policy = await settingsService.getSetting('leave_policy', null, cid);
  if (Array.isArray(policy) && policy.length) return policy;

  // Backward-compat: if only allocations exist
  const alloc = await settingsService.getSetting('leave_allocations', null, cid);
  if (alloc && typeof alloc === 'object') {
    return defaultPolicy(year).map((p) => ({ ...p, allocation: Number(alloc[p.code] ?? p.allocation) }));
  }

  return defaultPolicy(year);
};

const applyLeave = async (employeeId, data) => {
  const { leave_type, from_date, to_date, is_half_day, reason } = data;

  if (moment(to_date).isBefore(from_date)) {
    throw new BadRequestError('To date must be after from date');
  }

  const totalDays = calculateLeaveDays(from_date, to_date, is_half_day);

  const companyId = await resolveEmployeeCompanyId(employeeId);

  // Block applying for disabled leave types
  const year = moment(from_date).year();
  const policy = await getEffectiveLeavePolicy(year, companyId);
  const found = (policy || []).find((p) => p.code === leave_type);
  if (found && found.active === false) {
    throw new BadRequestError(`${leave_type} is disabled by Admin`);
  }

  // Enforce balance for any leave type that has a yearly allocation
  const allocated = Number(found?.allocation ?? 0);
  if (allocated > 0 || ['CL', 'SL', 'EL'].includes(leave_type)) {
    const { data: balance } = await supabaseAdmin
      .from('leave_balances')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('year', year)
      .eq('leave_type', leave_type)
      .maybeSingle();

    const totalAllocated = Number(balance?.total_allocated ?? allocated);
    const used = Number(balance?.used ?? 0);
    if ((totalAllocated - used) < totalDays) {
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

  // Notify manager (if any) else HR/Admin
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, manager_id')
    .eq('id', employeeId)
    .single();

  if (employee?.manager_id) {
    await notificationService.createNotification({
      user_id: employee.manager_id,
      type: 'LEAVE',
      title: 'Leave request pending approval',
      message: `${employee.first_name} ${employee.last_name} applied for leave (${leave_type}) from ${from_date} to ${to_date}.`,
      link: '/leave/team',
      meta: { leave_id: leave.id },
    });
  } else {
    const tenantService = require('./tenant.service');
    const hrIds = await tenantService.getCompanyHrAdminIds(companyId);
    for (const id of hrIds) {
      await notificationService.createNotification({
        user_id: id,
        type: 'LEAVE',
        title: 'Leave request submitted',
        message: `A leave request (${leave_type}) was submitted and needs review.`,
        link: '/leave/approvals',
        meta: { leave_id: leave.id },
      });
    }
  }

  return leave;
};

const getLeaves = async (filters, query) => {
  const { page, limit, offset } = paginate(query);
  let dbQuery = supabaseAdmin
    .from('leaves')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department, manager_id)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.employee_id) dbQuery = dbQuery.eq('employee_id', filters.employee_id);
  if (filters.employee_ids) dbQuery = dbQuery.in('employee_id', filters.employee_ids);
  if (filters.status) dbQuery = dbQuery.eq('status', filters.status);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data, meta: buildMeta(page, limit, count) };
};

const notifyLeaveApproved = async (leave) => {
  if (leave.employee) {
    leaveStatusEmail(leave.employee, leave, 'approved').catch(() => {});
  }
  await notificationService.createNotification({
    user_id: leave.employee_id,
    type: 'LEAVE',
    title: 'Leave approved',
    message: `Your leave request (${leave.leave_type}) has been approved.`,
    link: '/leave/me',
    meta: { leave_id: leave.id },
  });

  // Clear any leftover "needs HR approval" alerts for this leave (e.g. after switching to single-level)
  try {
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('type', 'LEAVE')
      .ilike('title', '%HR approval%')
      .contains('meta', { leave_id: leave.id });
  } catch {
    /* non-fatal */
  }
};

/** Reads Settings → Leave Policy → Approval Flow (leave_policy_meta). */
const getLeaveApprovalLevel = async (companyId = null) => {
  const meta = await settingsService.getSetting('leave_policy_meta', null, companyId || DEFAULT_COMPANY_ID);
  if (!meta || typeof meta !== 'object') return 'single';
  const level = String(meta.approval_level || meta.approvalLevel || 'single').toLowerCase();
  return level === 'two-level' || level === 'two_level' || level === 'two' ? 'two-level' : 'single';
};

const approveLeave = async (approver, leaveId, isManagerApproval = false) => {
  const { data: leave } = await supabaseAdmin.from('leaves').select('*, employee:employee_id(*)').eq('id', leaveId).single();
  if (!leave) throw new NotFoundError('Leave not found');
  if (leave.status !== 'pending' && !(isManagerApproval && !leave.manager_approved_by)) {
    throw new BadRequestError('Leave cannot be approved in current status');
  }

  const approverCompanyId = getCompanyId(approver) || approver.company_id || DEFAULT_COMPANY_ID;
  if (leave.employee && getCompanyId(leave.employee) !== approverCompanyId) {
    throw new ForbiddenError('Not authorized to approve leave for another company');
  }

  const approvalLevel = await getLeaveApprovalLevel(approverCompanyId);
  const singleLevel = approvalLevel === 'single';

  if (isManagerApproval && approver.role === 'manager') {
    const teamIds = await getTeamEmployeeIds(approver.id);
    if (!teamIds.includes(leave.employee_id)) {
      throw new ForbiddenError('Not authorized to approve this leave');
    }

    // Single-level: manager approval is final
    if (singleLevel) {
      const { data: updated, error } = await supabaseAdmin
        .from('leaves')
        .update({
          status: 'approved',
          manager_approved_by: approver.id,
          manager_approved_at: new Date().toISOString(),
          approved_by: approver.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', leaveId)
        .select()
        .single();
      if (error) throw new BadRequestError(error.message);
      await notifyLeaveApproved({ ...leave, id: leaveId });
      return updated;
    }

    // Two-level: record manager approval, then HR finalizes
    const { data: updated } = await supabaseAdmin
      .from('leaves')
      .update({
        manager_approved_by: approver.id,
        manager_approved_at: new Date().toISOString(),
      })
      .eq('id', leaveId)
      .select()
      .single();

    const tenantService = require('./tenant.service');
    const hrIds = await tenantService.getCompanyHrAdminIds(approverCompanyId);
    for (const id of hrIds) {
      await notificationService.createNotification({
        user_id: id,
        type: 'LEAVE',
        title: 'Leave needs HR approval',
        message: `Manager approved a leave request (${leave.leave_type}). Please review and approve/reject.`,
        link: '/leave/approvals',
        meta: { leave_id: leaveId, employee_id: leave.employee_id },
      });
    }

    return updated;
  }

  // HR/Admin final approval
  // Two-level only: require manager step first when employee has a manager
  if (!singleLevel && leave.employee?.manager_id && !leave.manager_approved_by) {
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

  await notifyLeaveApproved({ ...leave, id: leaveId });

  return updated;
};

const rejectLeave = async (approver, leaveId, rejection_reason) => {
  const { data: leave } = await supabaseAdmin.from('leaves').select('*, employee:employee_id(*)').eq('id', leaveId).single();
  if (!leave) throw new NotFoundError('Leave not found');
  if (!['pending'].includes(leave.status)) {
    throw new BadRequestError('Leave cannot be rejected');
  }

  const approverCompanyId = getCompanyId(approver) || approver.company_id || DEFAULT_COMPANY_ID;
  if (leave.employee && getCompanyId(leave.employee) !== approverCompanyId) {
    throw new ForbiddenError('Not authorized to reject leave for another company');
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

  await notificationService.createNotification({
    user_id: leave.employee_id,
    type: 'LEAVE',
    title: 'Leave rejected',
    message: `Your leave request (${leave.leave_type}) was rejected.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`,
    link: '/leave/me',
    meta: { leave_id: leaveId },
  });

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

const getLeaveBalance = async (employeeId, year, companyId = null) => {
  const targetYear = year || moment().year();
  const cid = companyId || await resolveEmployeeCompanyId(employeeId);

  // Ensure employee has leave balances rows (and allocations are dynamic from Settings)
  const policy = await getEffectiveLeavePolicy(targetYear, cid);
  const activePolicy = (policy || []).filter((p) => p && p.code && p.active !== false);
  const allocations = {};
  activePolicy.forEach((p) => { allocations[p.code] = Number(p.allocation || 0); });

  // Create missing rows so UI always reflects latest allocations for new employees/year
  const { data: existingRows } = await supabaseAdmin
    .from('leave_balances')
    .select('leave_type')
    .eq('employee_id', employeeId)
    .eq('year', targetYear);

  const existingTypes = new Set((existingRows || []).map((r) => r.leave_type));
  const inserts = [];
  for (const t of activePolicy.map((p) => p.code)) {
    if (existingTypes.has(t)) continue;
    inserts.push({
      employee_id: employeeId,
      year: targetYear,
      leave_type: t,
      total_allocated: Number(allocations?.[t] ?? 0),
      used: 0,
      encashed: 0,
    });
  }
  if (inserts.length) {
    await supabaseAdmin.from('leave_balances').insert(inserts);
  }

  const { data, error } = await supabaseAdmin
    .from('leave_balances')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('year', targetYear);

  if (error) throw new BadRequestError(error.message);

  const nameByCode = Object.fromEntries(
    activePolicy.map((p) => [p.code, p.name || p.code])
  );
  const activeCodes = new Set(activePolicy.map((p) => p.code));
  const filtered = (data || []).filter((b) => activeCodes.has(b.leave_type));

  // Prefer policy order so My Leave matches Settings → Leave Policy
  const byType = Object.fromEntries((filtered || []).map((b) => [b.leave_type, b]));

  // Keep totals in sync with latest policy on read (used/encashed preserved)
  for (const p of activePolicy) {
    const b = byType[p.code];
    const alloc = Number(p.allocation || 0);
    if (b && Number(b.total_allocated) !== alloc) {
      await supabaseAdmin
        .from('leave_balances')
        .update({ total_allocated: alloc })
        .eq('employee_id', employeeId)
        .eq('year', targetYear)
        .eq('leave_type', p.code);
      b.total_allocated = alloc;
    }
  }

  return activePolicy.map((p) => {
    const b = byType[p.code] || {
      leave_type: p.code,
      total_allocated: Number(p.allocation || 0),
      used: 0,
      encashed: 0,
    };
    return {
      ...b,
      name: nameByCode[p.code] || p.code,
      available: Number(b.total_allocated || 0) - Number(b.used || 0) - Number(b.encashed || 0),
    };
  });
};

const getLeaveCalendar = async (month, year, companyId = null) => {
  const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).format('YYYY-MM-DD');
  const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');

  const tenantService = require('./tenant.service');
  const employeeIds = await tenantService.getCompanyEmployeeIds(companyId || DEFAULT_COMPANY_ID);
  const emptyId = '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabaseAdmin
    .from('leaves')
    .select('*, employee:employee_id(first_name, last_name, department)')
    .eq('status', 'approved')
    .in('employee_id', employeeIds.length ? employeeIds : [emptyId])
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
  getEffectiveLeavePolicy,
};
