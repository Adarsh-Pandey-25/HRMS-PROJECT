const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { TIMEZONE } = require('../utils/constants');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const { paginate, buildMeta, nowIST } = require('../utils/helpers');
const notificationService = require('./notification.service');

const getTeamEmployeeIds = async (managerId) => {
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('manager_id', managerId)
    .eq('is_active', true);
  return (data || []).map((e) => e.id);
};

const todayIST = () => nowIST().format('YYYY-MM-DD');

const getRequestForDate = async (employeeId, workDate) => {
  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const isApprovedForDate = async (employeeId, workDate = todayIST()) => {
  const row = await getRequestForDate(employeeId, workDate);
  return Boolean(row && row.status === 'approved');
};

const requestWfh = async (employeeId, { work_date, reason } = {}) => {
  const workDate = work_date || todayIST();
  if (moment.tz(workDate, TIMEZONE).isBefore(nowIST().startOf('day'))) {
    throw new BadRequestError('Cannot request WFH for a past date');
  }

  const existing = await getRequestForDate(employeeId, workDate);
  if (existing) {
    if (existing.status === 'approved') {
      throw new ConflictError('WFH is already approved for this date');
    }
    if (existing.status === 'pending') {
      throw new ConflictError('A WFH request is already pending for this date');
    }
    // Rejected/cancelled → reopen as pending
    const { data, error } = await supabaseAdmin
      .from('wfh_day_requests')
      .update({
        status: 'pending',
        reason: reason || existing.reason,
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    await notifyReviewers(employeeId, workDate, data.id);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .insert({
      employee_id: employeeId,
      work_date: workDate,
      reason: reason || 'Working from home today',
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  await notifyReviewers(employeeId, workDate, data.id);
  return data;
};

const notifyReviewers = async (employeeId, workDate, requestId) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, manager_id')
    .eq('id', employeeId)
    .single();

  const name = employee ? `${employee.first_name} ${employee.last_name}` : 'An employee';
  const message = `${name} requested WFH for ${workDate}.`;
  const link = '/attendance/wfh-approvals';
  const meta = { wfh_request_id: requestId, work_date: workDate };

  if (employee?.manager_id) {
    await notificationService.createNotification({
      user_id: employee.manager_id,
      type: 'ATTENDANCE',
      title: 'WFH request pending',
      message,
      link,
      meta,
    });
  } else {
    const tenantService = require('./tenant.service');
    const { getCompanyId } = require('../utils/tenant');
    const { data: empFull } = await supabaseAdmin
      .from('employees')
      .select('address')
      .eq('id', employeeId)
      .maybeSingle();
    const hrIds = await tenantService.getCompanyHrAdminIds(empFull ? getCompanyId(empFull) : null);
    for (const id of hrIds) {
      await notificationService.createNotification({
        user_id: id,
        type: 'ATTENDANCE',
        title: 'WFH request pending',
        message,
        link,
        meta,
      });
    }
  }
};

const cancelRequest = async (employeeId, requestId) => {
  const { data: row } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (!row) throw new NotFoundError('WFH request not found');
  if (row.employee_id !== employeeId) throw new ForbiddenError('Not your request');
  if (row.status !== 'pending') throw new BadRequestError('Only pending requests can be cancelled');

  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const listMine = async (employeeId, query = {}) => {
  const { page, limit, offset } = paginate(query);
  const { data, error, count } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*', { count: 'exact' })
    .eq('employee_id', employeeId)
    .order('work_date', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], meta: buildMeta(page, limit, count) };
};

const listPendingForReviewer = async (reviewer, query = {}) => {
  const { page, limit, offset } = paginate(query);
  const role = reviewer.role;
  let employeeIds = null;

  if (role === 'manager') {
    employeeIds = await getTeamEmployeeIds(reviewer.id);
    if (!employeeIds.length) return { data: [], meta: buildMeta(page, limit, 0) };
  } else {
    const tenantService = require('./tenant.service');
    const { getCompanyId } = require('../utils/tenant');
    employeeIds = await tenantService.getCompanyEmployeeIds(reviewer.company_id || getCompanyId(reviewer));
    if (!employeeIds.length) return { data: [], meta: buildMeta(page, limit, 0) };
  }

  let dbQuery = supabaseAdmin
    .from('wfh_day_requests')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department, designation, manager_id)', { count: 'exact' })
    .eq('status', query.status || 'pending')
    .in('employee_id', employeeIds)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await dbQuery;
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], meta: buildMeta(page, limit, count) };
};

const review = async (reviewer, requestId, { status, review_note } = {}) => {
  if (!['approved', 'rejected'].includes(status)) {
    throw new BadRequestError('status must be approved or rejected');
  }

  const { data: row } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*, employee:employee_id(id, first_name, last_name, manager_id, address)')
    .eq('id', requestId)
    .single();
  if (!row) throw new NotFoundError('WFH request not found');
  if (row.status !== 'pending') throw new BadRequestError('Request is not pending');

  const role = reviewer.role;
  if (role === 'manager') {
    const teamIds = await getTeamEmployeeIds(reviewer.id);
    if (!teamIds.includes(row.employee_id)) {
      throw new ForbiddenError('You can only review your team members');
    }
  } else if (['hr', 'admin'].includes(role)) {
    const { getCompanyId } = require('../utils/tenant');
    const reviewerCompany = reviewer.company_id || getCompanyId(reviewer);
    if (row.employee && getCompanyId(row.employee) !== reviewerCompany) {
      throw new ForbiddenError('Not authorized to review WFH for another company');
    }
  } else {
    throw new ForbiddenError('Only manager, HR or Admin can review WFH requests');
  }

  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .update({
      status,
      reviewed_by: reviewer.id,
      reviewed_at: new Date().toISOString(),
      review_note: review_note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);

  await notificationService.createNotification({
    user_id: row.employee_id,
    type: 'ATTENDANCE',
    title: status === 'approved' ? 'WFH approved' : 'WFH rejected',
    message: status === 'approved'
      ? `Your WFH request for ${row.work_date} was approved. You can clock in from any network.`
      : `Your WFH request for ${row.work_date} was rejected.${review_note ? ` ${review_note}` : ''}`,
    link: '/attendance/me',
    meta: { wfh_request_id: requestId, work_date: row.work_date, status },
  });

  return data;
};

module.exports = {
  todayIST,
  getRequestForDate,
  isApprovedForDate,
  requestWfh,
  cancelRequest,
  listMine,
  listPendingForReviewer,
  review,
};
