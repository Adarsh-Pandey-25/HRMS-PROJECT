const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { TIMEZONE } = require('../utils/constants');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const { paginate, buildMeta, nowIST, isMissingColumnError } = require('../utils/helpers');
const notificationService = require('./notification.service');
const approvalFlow = require('./approvalFlow.service');

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

/** A WFH request for the day still waiting for a decision (a check-in now is provisional). */
const isPendingForDate = async (employeeId, workDate = todayIST()) => {
  const row = await getRequestForDate(employeeId, workDate);
  return Boolean(row && row.status === 'pending');
};

const fmtTime = (iso) => moment(iso).tz(TIMEZONE).format('h:mm A');

/**
 * Check-ins made while the request was still waiting (attendance.service.js
 * checkIn marks them location.wfh_pending; owner's decision, 2 Nov 2026 — no
 * one loses hours to a late approval).
 *  - approved: they count, from their own check-in time;
 *  - rejected or cancelled: they are taken out of attendance, so no summary,
 *    payslip or report counts the day, and their times stay on the request,
 *    where the profile shows them as not counted. The audit log keeps the
 *    full record either way.
 * Returns the check-in times it settled, for the notice to the employee.
 */
const settleProvisionalCheckIns = async (employeeId, dayRows, outcome, actor) => {
  const dates = [...new Set((dayRows || []).map((r) => r.work_date))].sort();
  if (!dates.length) return [];
  const { data: rows, error } = await supabaseAdmin
    .from('attendance')
    .select('id, company_id, check_in_time, check_out_time, check_in_method, total_hours, status, location')
    .eq('employee_id', employeeId)
    .gte('check_in_time', moment.tz(dates[0], TIMEZONE).startOf('day').toISOString())
    .lte('check_in_time', moment.tz(dates[dates.length - 1], TIMEZONE).endOf('day').toISOString());
  if (error) throw new BadRequestError(error.message);

  const provisional = (rows || []).filter((r) => r.location?.wfh_pending === true
    && dates.includes(moment(r.check_in_time).tz(TIMEZONE).format('YYYY-MM-DD')));
  const now = new Date().toISOString();
  const auditLog = require('./auditLog.service');
  for (const row of provisional) {
    /* eslint-disable no-await-in-loop */
    if (outcome === 'approved') {
      const { wfh_pending: _pending, ...location } = row.location;
      const { error: confirmError } = await supabaseAdmin
        .from('attendance')
        .update({ location: { ...location, wfh_confirmed_at: now }, updated_at: now })
        .eq('id', row.id);
      if (confirmError) throw new BadRequestError(confirmError.message);
    } else {
      const workDate = moment(row.check_in_time).tz(TIMEZONE).format('YYYY-MM-DD');
      const dayRow = dayRows.find((d) => d.work_date === workDate);
      if (dayRow) {
        const { error: keepError } = await supabaseAdmin
          .from('wfh_day_requests')
          .update({ voided_check_in_at: row.check_in_time, voided_check_out_at: row.check_out_time })
          .eq('id', dayRow.id);
        // Before 20261102_wfh_approval_flow.sql the columns are missing; the
        // audit log below still keeps the check-in.
        if (keepError) require('../utils/logger').warn('[WFH] could not keep a voided check-in on the request', { error: keepError.message });
      }
      await auditLog.logAudit({
        companyId: row.company_id,
        actorId: actor?.id || null,
        actorRole: actor?.role || 'system',
        actionType: 'attendance.void_provisional_wfh',
        targetType: 'attendance',
        targetId: row.id,
        beforeState: row,
        afterState: { reason: `WFH request ${outcome}` },
      });
      const { error: voidError } = await supabaseAdmin.from('attendance').delete().eq('id', row.id);
      if (voidError) throw new BadRequestError(voidError.message);
    }
    /* eslint-enable no-await-in-loop */
  }
  return provisional.map((r) => fmtTime(r.check_in_time));
};

// The decision itself is already saved: a failure here is logged loudly for
// a fix by hand, not turned into a failed approval.
const settleSafely = async (employeeId, dayRows, outcome, actor) => {
  try {
    return await settleProvisionalCheckIns(employeeId, dayRows, outcome, actor);
  } catch (err) {
    require('../utils/logger').error('[WFH] could not settle a provisional check-in — fix by hand', {
      employeeId, outcome, dates: (dayRows || []).map((r) => r.work_date), error: err.message,
    });
    return [];
  }
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
  const reason = String(body.reason || '').trim().slice(0, 500) || 'Working from home';

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
   * employee's own rejected or cancelled ones, whose stale review (and
   * manager approval, and a voided check-in) is cleared here: the day starts
   * over. (The audit log keeps any voided check-in.)
   */
  const upsertDays = (withNewColumns) => supabaseAdmin
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
        ...(withNewColumns ? {
          manager_approved_by: null, manager_approved_at: null, voided_check_in_at: null, voided_check_out_at: null,
        } : {}),
        updated_at: nowIso,
      })),
      { onConflict: 'employee_id,work_date' },
    )
    .select()
    .order('work_date', { ascending: true });
  let { data: created, error: upsertErr } = await upsertDays(true);
  // Before 20261102_wfh_approval_flow.sql has run, those columns don't exist.
  if (upsertErr && ['manager_approved_by', 'manager_approved_at', 'voided_check_in_at', 'voided_check_out_at']
    .some((column) => isMissingColumnError(upsertErr.message, column))) {
    ({ data: created, error: upsertErr } = await upsertDays(false));
  }
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

  // Whoever acts first under Settings → Approval Flows: the manager, HR (HR
  // only, or no manager), or both at once (Manager or HR, the default) —
  // whoever decides first settles it, as review() refuses a request that is
  // no longer pending. Nobody is asked to review their own request.
  const reviewerIds = new Set();
  try {
    const tenantService = require('./tenant.service');
    const { getCompanyId } = require('../utils/tenant');
    const { data: empFull } = await supabaseAdmin
      .from('employees')
      .select('address, company_id')
      .eq('id', employeeId)
      .maybeSingle();
    const companyId = empFull ? getCompanyId(empFull) : null;
    const flow = await approvalFlow.getWfhFlow(companyId);
    const firstStage = approvalFlow.awaitingStage(flow, { hasManager: Boolean(employee?.manager_id), managerApproved: false });
    if (approvalFlow.isTurnOf(firstStage, 'manager')) reviewerIds.add(employee.manager_id);
    if (approvalFlow.isTurnOf(firstStage, 'hr')) {
      for (const id of await tenantService.getCompanyHrAdminIds(companyId)) reviewerIds.add(id);
    }
  } catch (err) {
    // The request is saved either way, and shows on the WFH approvals page.
    require('../utils/logger').warn('[WFH] could not work out who to notify', { error: err.message });
    if (employee?.manager_id) reviewerIds.add(employee.manager_id);
  }
  reviewerIds.delete(employeeId);

  for (const id of reviewerIds) {
    await notificationService.createNotification({
      user_id: id,
      type: 'ATTENDANCE',
      title: 'WFH request pending',
      message,
      link,
      meta,
    });
  }
};

/** Every still-pending day-row belonging to the same request as `requestId`. */
const loadBatchRows = async (requestId, { pendingOnly = false } = {}) => {
  const { data: row } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*, employee:employee_id(id, company_id, first_name, last_name, manager_id, address)')
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
    .eq('status', 'pending')
    .select();
  if (error) throw new BadRequestError(error.message);
  // A cancelled request needs nobody's review.
  await notificationService.markReviewNotificationsRead('wfh', anchor.batch_id);
  // A check-in made while it waited no longer has a request behind it.
  await settleSafely(employeeId, data || [], 'cancelled', { id: employeeId, role: 'employee' });
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
  const { getCompanyId } = require('../utils/tenant');
  const companyId = reviewer.company_id || getCompanyId(reviewer);
  let employeeIds = null;

  if (role === 'manager') {
    employeeIds = await getTeamEmployeeIds(reviewer.id, companyId);
    if (!employeeIds.length) return { data: [], meta: buildMeta(page, limit, 0) };
  } else {
    const tenantService = require('./tenant.service');
    employeeIds = await tenantService.getCompanyEmployeeIds(companyId);
    if (!employeeIds.length) return { data: [], meta: buildMeta(page, limit, 0) };
  }

  const status = query.status || 'pending';
  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, department, designation, manager_id)')
    .eq('status', status)
    .in('employee_id', employeeIds)
    .order('created_at', { ascending: true })
    .limit(MAX_GROUPING_ROWS);
  if (error) throw new BadRequestError(error.message);

  let groups = groupRows(data || []);
  // A pending request sits in the queue of whoever's turn it is under
  // Settings → Approval Flows ('awaiting' tells the page which step it is at).
  if (status === 'pending') {
    const flow = await approvalFlow.getWfhFlow(companyId);
    const mine = role === 'manager' ? 'manager' : 'hr';
    groups = groups
      .map((g) => ({
        ...g,
        awaiting: approvalFlow.awaitingStage(flow, { hasManager: Boolean(g.employee?.manager_id), managerApproved: Boolean(g.manager_approved_by) }),
      }))
      // An HR or admin who is the employee's own manager decides that step too.
      .filter((g) => approvalFlow.isTurnOf(g.awaiting, mine)
        || (mine === 'hr' && String(g.employee?.manager_id || '') === String(reviewer.id)));
  }
  groups.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  return {
    data: groups.slice(offset, offset + limit),
    meta: buildMeta(page, limit, groups.length),
  };
};

/** Manager → HR, first step: the manager approved; every HR / admin is asked for the final approval. */
const recordManagerApproval = async (reviewer, anchor, pending, companyId) => {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .update({ manager_approved_by: reviewer.id, manager_approved_at: now, updated_at: now })
    .in('id', pending.map((r) => r.id))
    .eq('status', 'pending')
    .is('manager_approved_by', null)
    .select();
  if (error && isMissingColumnError(error.message, 'manager_approved_by')) {
    throw new BadRequestError('Manager → HR for work from home needs the database update 20261102_wfh_approval_flow.sql');
  }
  if (error) throw new BadRequestError(error.message);
  if (!(data || []).length) throw new ConflictError('This request was already reviewed');
  // The manager's part is done; HR's notifications follow.
  await notificationService.markReviewNotificationsRead('wfh', anchor.batch_id, { firstStepOnly: true });

  const approved = toRequestGroup(data);
  const name = anchor.employee ? `${anchor.employee.first_name} ${anchor.employee.last_name}` : 'An employee';
  const span = approved.total_days > 1
    ? `${approved.from_date} to ${approved.to_date} (${approved.total_days} days)`
    : approved.from_date;
  const tenantService = require('./tenant.service');
  for (const id of await tenantService.getCompanyHrAdminIds(companyId)) {
    if (id === anchor.employee_id) continue;
    await notificationService.createNotification({
      user_id: id,
      type: 'ATTENDANCE',
      title: 'WFH needs HR approval',
      message: `${name}'s manager approved WFH for ${span}. Please approve or reject it.`,
      link: '/attendance/wfh-approvals',
      meta: { wfh_batch_id: anchor.batch_id, work_date: approved.from_date, work_dates: approved.work_dates },
    });
  }
  return approved;
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
  const { getCompanyId } = require('../utils/tenant');
  const reviewerCompany = reviewer.company_id || getCompanyId(reviewer);
  let managesEmployee = false;
  if (role === 'manager') {
    const teamIds = await getTeamEmployeeIds(reviewer.id, reviewerCompany);
    if (!teamIds.includes(anchor.employee_id)) {
      throw new ForbiddenError('You can only review your team members');
    }
    managesEmployee = true;
  } else if (['hr', 'admin'].includes(role)) {
    if (!anchor.employee || getCompanyId(anchor.employee) !== reviewerCompany) {
      throw new ForbiddenError('Not authorized to review WFH for another company');
    }
  } else {
    throw new ForbiddenError('Only manager, HR or Admin can review WFH requests');
  }

  // Settings → Approval Flows → Work from home (approvalFlow.service.js).
  const flow = await approvalFlow.getWfhFlow(reviewerCompany);
  const context = {
    actorId: reviewer.id,
    employeeId: anchor.employee_id,
    actorRole: role,
    managesEmployee,
    hasManager: Boolean(anchor.employee?.manager_id),
    // An HR or admin who is also the employee's own manager covers both steps.
    managerApproved: pending.every((r) => r.manager_approved_by)
      || (approvalFlow.isHrRole(role) && String(anchor.employee?.manager_id || '') === String(reviewer.id)),
    what: 'WFH request',
  };
  const verdict = status === 'approved'
    ? approvalFlow.decideApproval(flow, context)
    : approvalFlow.decideRejection(flow, context);
  if (!verdict.ok) {
    throw verdict.status === 403 ? new ForbiddenError(verdict.message) : new BadRequestError(verdict.message);
  }
  // Manager → HR: the manager's approval is recorded; HR gives the final one.
  if (status === 'approved' && !verdict.final) return recordManagerApproval(reviewer, anchor, pending, reviewerCompany);

  const { data, error } = await supabaseAdmin
    .from('wfh_day_requests')
    .update({
      status,
      reviewed_by: reviewer.id,
      reviewed_at: new Date().toISOString(),
      review_note: review_note ? String(review_note).slice(0, 1000) : null,
      updated_at: new Date().toISOString(),
    })
    .in('id', pending.map((r) => r.id))
    .eq('status', 'pending') // a second reviewer acting at the same moment changes nothing
    .select();
  if (!error && !(data || []).length) throw new ConflictError('This request was already reviewed');
  if (error) throw new BadRequestError(error.message);
  // Decided: every reviewer's "please review" notification is marked read.
  await notificationService.markReviewNotificationsRead('wfh', anchor.batch_id);

  const reviewed = toRequestGroup(data || []);
  const span = reviewed && reviewed.total_days > 1
    ? `${reviewed.from_date} to ${reviewed.to_date} (${reviewed.total_days} days)`
    : anchor.work_date;
  // A check-in made while it waited now counts, or is taken out.
  const settled = await settleSafely(anchor.employee_id, data || [], status, reviewer);
  const checkInNote = settled.length
    ? (status === 'approved'
      ? ` Your check-in at ${settled.join(', ')} counts.`
      : ` Your check-in at ${settled.join(', ')} was not counted.`)
    : '';

  await notificationService.createNotification({
    user_id: anchor.employee_id,
    type: 'ATTENDANCE',
    title: status === 'approved' ? 'WFH approved' : 'WFH rejected',
    message: status === 'approved'
      ? `Your WFH request for ${span} was approved. You can clock in from any network.${checkInNote}`
      : `Your WFH request for ${span} was rejected.${review_note ? ` ${review_note}` : ''}${checkInNote}`,
    link: '/attendance/me',
    meta: { wfh_request_id: requestId, work_date: anchor.work_date, status },
  });

  return reviewed;
};

module.exports = {
  todayIST,
  getRequestForDate,
  isApprovedForDate,
  isPendingForDate,
  requestWfh,
  cancelRequest,
  listMine,
  listPendingForReviewer,
  review,
  MAX_RANGE_DAYS,
};
