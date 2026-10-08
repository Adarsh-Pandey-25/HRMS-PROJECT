const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { TIMEZONE } = require('../utils/constants');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const { paginate, buildMeta, nowIST } = require('../utils/helpers');
const notificationService = require('./notification.service');

/** A single request may not span more than this many calendar days. */
const MAX_RANGE_DAYS = 90;
/**
 * Upper bound on rows pulled before grouping into requests. Grouping happens
 * in JS (one request = N day-rows), so pagination can't be pushed into SQL.
 * Pending/visible WFH rows per company sit far below this in practice.
 */
const MAX_GROUPING_ROWS = 2000;

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

/**
 * Every calendar day from..to inclusive, as YYYY-MM-DD.
 *
 * Calendar days, not working days: leave does the same (see
 * helpers.calculateLeaveDays), so a WFH range spanning a weekend counts the
 * same way a leave range does.
 */
const expandDateRange = (fromDate, toDate) => {
  const out = [];
  const cursor = moment.tz(fromDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
  const last = moment.tz(toDate, 'YYYY-MM-DD', TIMEZONE).startOf('day');
  while (cursor.isSameOrBefore(last)) {
    out.push(cursor.format('YYYY-MM-DD'));
    cursor.add(1, 'day');
  }
  return out;
};

const isValidDate = (value) => moment(value, 'YYYY-MM-DD', true).isValid();

/**
 * Normalises the three accepted shapes into a validated date list:
 *   { from_date, to_date }  — a range (what Apply WFH sends)
 *   { work_date }           — one day
 *   {}                      — today, the original same-day behaviour
 */
const resolveRequestedDates = ({ from_date, to_date, work_date } = {}) => {
  const from = from_date || work_date || todayIST();
  const to = to_date || from_date || work_date || todayIST();

  if (!isValidDate(from) || !isValidDate(to)) {
    throw new BadRequestError('Dates must be in YYYY-MM-DD format');
  }

  const start = moment.tz(from, 'YYYY-MM-DD', TIMEZONE).startOf('day');
  const end = moment.tz(to, 'YYYY-MM-DD', TIMEZONE).startOf('day');

  if (end.isBefore(start)) {
    throw new BadRequestError('End date cannot be before start date');
  }
  if (start.isBefore(nowIST().startOf('day'))) {
    throw new BadRequestError('Cannot request WFH for a past date');
  }
  const span = end.diff(start, 'days') + 1;
  if (span > MAX_RANGE_DAYS) {
    throw new BadRequestError(`A WFH request can span at most ${MAX_RANGE_DAYS} days`);
  }

  return expandDateRange(from, to);
};

/**
 * Submit WFH for one day or a date range.
 *
 * One row per day (the table's UNIQUE (employee_id, work_date) and the
 * check-in gate both depend on that), tied together by a shared batch_id so
 * the range lists and reviews as a single request.
 *
 * Dates already pending or approved block the whole submission rather than
 * being silently skipped — the caller is told exactly which ones clash, so
 * nothing is half-applied without the employee knowing. Dates whose previous
 * request was rejected or cancelled are reopened into the new batch, which is
 * what the single-day flow always did.
 */
const requestWfh = async (employeeId, body = {}) => {
  const dates = resolveRequestedDates(body);
  const reason = body.reason || 'Working from home';

  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .in('work_date', dates);
  if (existingErr) throw new BadRequestError(existingErr.message);

  const existingByDate = new Map((existingRows || []).map((r) => [r.work_date, r]));

  const blocked = dates.filter((d) => {
    const row = existingByDate.get(d);
    return row && (row.status === 'pending' || row.status === 'approved');
  });
  if (blocked.length) {
    const shown = blocked.slice(0, 5).join(', ');
    const more = blocked.length > 5 ? ` and ${blocked.length - 5} more` : '';
    throw new ConflictError(
      blocked.length === dates.length && dates.length === 1
        ? `WFH is already ${existingByDate.get(blocked[0]).status} for ${blocked[0]}`
        : `WFH is already requested or approved for: ${shown}${more}. Pick dates that are free.`,
    );
  }

  const batchId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  /**
   * One upsert for the whole range, rather than inserting new days and
   * updating reopened ones separately: a single statement is atomic, so a
   * date that another request grabs in between fails the whole submission
   * instead of leaving half the range applied. Conflicts resolve on the
   * table's UNIQUE (employee_id, work_date) — and since pending/approved
   * days were rejected above, the only rows this can overwrite are the
   * employee's own rejected or cancelled ones, whose stale review is
   * cleared here.
   */
  const { data: created, error: upsertErr } = await supabaseAdmin
    .from('wfh_day_requests')
    .upsert(
      dates.map((work_date) => ({
        employee_id: employeeId,
        work_date,
        reason,
        status: 'pending',
        batch_id: batchId,
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        updated_at: nowIso,
      })),
      { onConflict: 'employee_id,work_date' },
    )
    .select()
    .order('work_date', { ascending: true });
  if (upsertErr) throw new BadRequestError(upsertErr.message);

  // One notification for the whole range, not one per day.
  await notifyReviewers(employeeId, dates, batchId);

  return toRequestGroup(created || []);
};

/**
 * Collapses the day-rows of one request into the single object the API
 * returns. `id` stays the first day's row id so existing review/cancel
 * routes keep working unchanged.
 */
const toRequestGroup = (rows) => {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    ...first,
    id: first.id,
    batch_id: first.batch_id || null,
    from_date: first.work_date,
    to_date: last.work_date,
    total_days: sorted.length,
    work_dates: sorted.map((r) => r.work_date),
    day_ids: sorted.map((r) => r.id),
    // A batch is only "approved" once every day in it is.
    status: sorted.every((r) => r.status === sorted[0].status) ? sorted[0].status : 'partial',
  };
};

/** Groups day-rows into requests: by batch_id, or standalone for legacy NULL rows. */
const groupRows = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = row.batch_id || `single:${row.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((group) => {
    const merged = toRequestGroup(group);
    // Preserve the joined employee record the list queries select.
    const withEmployee = group.find((r) => r.employee);
    if (withEmployee) merged.employee = withEmployee.employee;
    return merged;
  });
};

const notifyReviewers = async (employeeId, dates, batchId) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, manager_id')
    .eq('id', employeeId)
    .single();

  const name = employee ? `${employee.first_name} ${employee.last_name}` : 'An employee';
  const span = dates.length === 1
    ? dates[0]
    : `${dates[0]} to ${dates[dates.length - 1]} (${dates.length} days)`;
  const message = `${name} requested WFH for ${span}.`;
  const link = '/attendance/wfh-approvals';
  const meta = { wfh_batch_id: batchId, work_date: dates[0], work_dates: dates };

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

/** Every still-pending day-row belonging to the same request as `requestId`. */
const loadBatchRows = async (requestId, { pendingOnly = false } = {}) => {
  const { data: row } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*, employee:employee_id(id, first_name, last_name, manager_id, address)')
    .eq('id', requestId)
    .maybeSingle();
  if (!row) throw new NotFoundError('WFH request not found');

  if (!row.batch_id) return { anchor: row, rows: [row] };

  let query = supabaseAdmin
    .from('wfh_day_requests')
    .select('*')
    .eq('batch_id', row.batch_id);
  if (pendingOnly) query = query.eq('status', 'pending');

  const { data, error } = await query.order('work_date', { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return { anchor: row, rows: data && data.length ? data : [row] };
};

const cancelRequest = async (employeeId, requestId) => {
  const { anchor, rows } = await loadBatchRows(requestId);
  if (anchor.employee_id !== employeeId) throw new ForbiddenError('Not your request');

  const pending = rows.filter((r) => r.status === 'pending');
  if (!pending.length) throw new BadRequestError('Only pending requests can be cancelled');

  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', pending.map((r) => r.id))
    .select();
  if (error) throw new BadRequestError(error.message);
  return toRequestGroup(data || []);
};

const listMine = async (employeeId, query = {}) => {
  const { page, limit, offset } = paginate(query);

  let dbQuery = supabaseAdmin
    .from('wfh_day_requests')
    .select('*')
    .eq('employee_id', employeeId);
  if (query.status) dbQuery = dbQuery.eq('status', query.status);

  const { data, error } = await dbQuery
    .order('work_date', { ascending: false })
    .limit(MAX_GROUPING_ROWS);
  if (error) throw new BadRequestError(error.message);

  const groups = groupRows(data || [])
    .sort((a, b) => String(b.from_date).localeCompare(String(a.from_date)));

  return {
    data: groups.slice(offset, offset + limit),
    meta: buildMeta(page, limit, groups.length),
  };
};

const listPendingForReviewer = async (reviewer, query = {}) => {
  const { page, limit, offset } = paginate(query);
  const role = reviewer.role;
  let employeeIds = null;

  if (role === 'manager') {
    const { getCompanyId } = require('../utils/tenant');
    employeeIds = await getTeamEmployeeIds(reviewer.id, reviewer.company_id || getCompanyId(reviewer));
    if (!employeeIds.length) return { data: [], meta: buildMeta(page, limit, 0) };
  } else {
    const tenantService = require('./tenant.service');
    const { getCompanyId } = require('../utils/tenant');
    employeeIds = await tenantService.getCompanyEmployeeIds(reviewer.company_id || getCompanyId(reviewer));
    if (!employeeIds.length) return { data: [], meta: buildMeta(page, limit, 0) };
  }

  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department, designation, manager_id)')
    .eq('status', query.status || 'pending')
    .in('employee_id', employeeIds)
    .order('created_at', { ascending: true })
    .limit(MAX_GROUPING_ROWS);
  if (error) throw new BadRequestError(error.message);

  const groups = groupRows(data || [])
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  return {
    data: groups.slice(offset, offset + limit),
    meta: buildMeta(page, limit, groups.length),
  };
};

const review = async (reviewer, requestId, { status, review_note } = {}) => {
  if (!['approved', 'rejected'].includes(status)) {
    throw new BadRequestError('status must be approved or rejected');
  }

  const { anchor, rows } = await loadBatchRows(requestId, { pendingOnly: true });
  const pending = rows.filter((r) => r.status === 'pending');
  if (!pending.length) throw new BadRequestError('Request is not pending');

  // Nobody approves their own WFH. Under the 'wfh_only' web check-in mode an
  // approved WFH day is what unlocks web check-in, so self-approval would let
  // HR or an admin skip the biometric device at will. Same rule manualEntry
  // applies to attendance (audit finding N-03).
  if (anchor.employee_id === reviewer.id) {
    throw new ForbiddenError('You cannot review your own WFH request — another HR member or admin has to.');
  }

  const role = reviewer.role;
  if (role === 'manager') {
    const { getCompanyId } = require('../utils/tenant');
    const teamIds = await getTeamEmployeeIds(reviewer.id, reviewer.company_id || getCompanyId(reviewer));
    if (!teamIds.includes(anchor.employee_id)) {
      throw new ForbiddenError('You can only review your team members');
    }
  } else if (['hr', 'admin'].includes(role)) {
    const { getCompanyId } = require('../utils/tenant');
    const reviewerCompany = reviewer.company_id || getCompanyId(reviewer);
    if (anchor.employee && getCompanyId(anchor.employee) !== reviewerCompany) {
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
    .in('id', pending.map((r) => r.id))
    .select();
  if (error) throw new BadRequestError(error.message);

  const reviewed = toRequestGroup(data || []);
  const span = reviewed && reviewed.total_days > 1
    ? `${reviewed.from_date} to ${reviewed.to_date} (${reviewed.total_days} days)`
    : anchor.work_date;

  await notificationService.createNotification({
    user_id: anchor.employee_id,
    type: 'ATTENDANCE',
    title: status === 'approved' ? 'WFH approved' : 'WFH rejected',
    message: status === 'approved'
      ? `Your WFH request for ${span} was approved. You can clock in from any network.`
      : `Your WFH request for ${span} was rejected.${review_note ? ` ${review_note}` : ''}`,
    link: '/attendance/me',
    meta: { wfh_request_id: requestId, work_date: anchor.work_date, status },
  });

  return reviewed;
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
  MAX_RANGE_DAYS,
};
