const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const logger = require('../utils/logger');

/** Monthly earning components payroll.service.js reads from salary_details. */
const SALARY_COMPONENTS = ['basic', 'hra', 'da', 'special', 'transport', 'medical'];

/** Stored CTC figures go stale the moment components change; payroll derives
 *  CTC from the components (monthly × 12) when none is stored. */
const STALE_CTC_KEYS = ['ctc', 'annual_ctc', 'annualCtc'];

const MAX_SCHEDULE_AHEAD_DAYS = 366;

const REVISION_SELECT = `*,
  employee:employee_id(id, first_name, last_name, employee_code, designation, department, profile_picture),
  creator:created_by(id, first_name, last_name)`;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const todayIst = () => moment().tz(TIMEZONE).format('YYYY-MM-DD');
const fullName = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim();

const pickComponents = (salary = {}) =>
  SALARY_COMPONENTS.reduce((acc, k) => ({ ...acc, [k]: round2(salary?.[k]) }), {});

const monthlyGross = (components) =>
  round2(SALARY_COMPONENTS.reduce((sum, k) => sum + Number(components?.[k] || 0), 0));

const normalizeComponents = (input = {}) => {
  const out = {};
  for (const k of SALARY_COMPONENTS) {
    const raw = input[k];
    const n = raw === undefined || raw === null || raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestError(`${k.toUpperCase()} must be a positive amount`);
    out[k] = round2(n);
  }
  if (out.basic <= 0) throw new BadRequestError('Basic salary must be greater than zero');
  return out;
};

const loadEmployeeInScope = async (employeeId, scopeIds) => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, first_name, last_name, email, is_active, salary_details')
    .eq('id', employeeId)
    .in('company_id', scopeIds)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Employee not found');
  return data;
};

const listRevisions = async ({ scopeIds, employeeId, status, limit = 200 }) => {
  let query = supabaseAdmin
    .from('salary_revisions')
    .select(REVISION_SELECT)
    .in('company_id', scopeIds)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 200, 500));
  if (employeeId) query = query.eq('employee_id', employeeId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const fetchRevision = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('salary_revisions')
    .select(REVISION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  return data;
};

/**
 * Copy a scheduled revision's components into employees.salary_details.
 * The revision row is claimed first (scheduled -> applied, conditional on
 * still being scheduled) so the cron and a manual request can never apply
 * the same revision twice; if the employee write then fails, the claim is
 * rolled back so the next cron run retries it.
 */
const applyRevision = async (revisionId, { actorId = null, actorRole = 'system', ipAddress = null } = {}) => {
  const { data: rev, error: revError } = await supabaseAdmin
    .from('salary_revisions')
    .select('*')
    .eq('id', revisionId)
    .maybeSingle();
  if (revError) throw new BadRequestError(revError.message);
  if (!rev || rev.status !== 'scheduled') return null;

  const { data: employee, error: empError } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, first_name, last_name, email, salary_details')
    .eq('id', rev.employee_id)
    .maybeSingle();
  if (empError) throw new BadRequestError(empError.message);
  if (!employee) throw new NotFoundError('Employee not found');

  const currentDetails = employee.salary_details || {};
  const previousComponents = pickComponents(currentDetails);
  const previousGross = monthlyGross(previousComponents);
  const nextDetails = { ...currentDetails, ...rev.new_salary };
  for (const k of STALE_CTC_KEYS) delete nextDetails[k];

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('salary_revisions')
    .update({
      status: 'applied',
      applied_at: nowIso,
      previous_salary: previousComponents,
      previous_monthly_gross: previousGross,
    })
    .eq('id', rev.id)
    .eq('status', 'scheduled')
    .select('id');
  if (claimError) throw new BadRequestError(claimError.message);
  if (!claimed?.length) return null; // applied or cancelled in the meantime

  const { error: updateError } = await supabaseAdmin
    .from('employees')
    .update({ salary_details: nextDetails, updated_at: nowIso })
    .eq('id', employee.id);
  if (updateError) {
    await supabaseAdmin
      .from('salary_revisions')
      .update({ status: 'scheduled', applied_at: null })
      .eq('id', rev.id);
    throw new BadRequestError(`Could not update salary: ${updateError.message}`);
  }

  const { error: eventError } = await supabaseAdmin.from('employee_career_events').insert({
    employee_id: employee.id,
    company_id: employee.company_id,
    event_type: 'salary_change',
    from_value: JSON.stringify(currentDetails),
    to_value: JSON.stringify(nextDetails),
    effective_date: rev.effective_date,
    note: rev.reason || null,
    created_by: rev.created_by || actorId,
  });
  if (eventError) logger.warn('[SalaryRevision] Career event not logged', { revisionId: rev.id, error: eventError.message });

  require('./auditLog.service').logAudit({
    companyId: employee.company_id,
    actorId: actorId || rev.created_by,
    actorRole,
    actionType: 'salary_revision.apply',
    targetType: 'employee',
    targetId: employee.id,
    beforeState: previousComponents,
    afterState: { ...rev.new_salary, effective_date: rev.effective_date, revision_id: rev.id },
    ipAddress,
  }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

  if (employee.email) {
    let revisedBy = null;
    if (rev.created_by) {
      const { data: creator } = await supabaseAdmin
        .from('employees').select('first_name, last_name').eq('id', rev.created_by).maybeSingle();
      revisedBy = fullName(creator) || null;
    }
    require('./email.service').salaryRevisedEmail(employee, {
      previousCtc: previousGross * 12,
      revisedCtc: Number(rev.new_monthly_gross) * 12,
      effectiveDate: rev.effective_date,
      revisedBy,
    }).catch((e) => logger.warn('[SalaryRevision] Email failed', { revisionId: rev.id, error: e.message }));
  }

  return rev.id;
};

const createRevision = async ({ scopeIds, actor, ipAddress, employeeId, components, effectiveDate, reason }) => {
  const employee = await loadEmployeeInScope(employeeId, scopeIds);
  if (employee.is_active === false) throw new BadRequestError('Salary can only be revised for active employees');

  const newSalary = normalizeComponents(components);
  const newGross = monthlyGross(newSalary);
  const current = pickComponents(employee.salary_details);
  if (SALARY_COMPONENTS.every((k) => current[k] === newSalary[k])) {
    throw new BadRequestError('The new salary is the same as the current salary');
  }

  const effective = moment.tz(String(effectiveDate || ''), 'YYYY-MM-DD', true, TIMEZONE);
  if (!effective.isValid()) throw new BadRequestError('Effective date must be a valid date');
  const today = todayIst();
  if (effective.diff(moment.tz(today, TIMEZONE), 'days') > MAX_SCHEDULE_AHEAD_DAYS) {
    throw new BadRequestError('Effective date can be at most one year ahead');
  }
  const effectiveStr = effective.format('YYYY-MM-DD');

  const { data: inserted, error } = await supabaseAdmin
    .from('salary_revisions')
    .insert({
      company_id: employee.company_id,
      employee_id: employee.id,
      previous_salary: current,
      new_salary: newSalary,
      previous_monthly_gross: monthlyGross(current),
      new_monthly_gross: newGross,
      effective_date: effectiveStr,
      reason: reason ? String(reason).trim().slice(0, 1000) : null,
      status: 'scheduled',
      created_by: actor.id,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new ConflictError(`${fullName(employee)} already has a scheduled revision. Cancel it first to schedule a new one.`);
    }
    throw new BadRequestError(error.message);
  }

  require('./auditLog.service').logAudit({
    companyId: employee.company_id,
    actorId: actor.id,
    actorRole: actor.role,
    actionType: 'salary_revision.create',
    targetType: 'employee',
    targetId: employee.id,
    beforeState: current,
    afterState: { ...newSalary, effective_date: effectiveStr, reason: reason || null },
    ipAddress,
  }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

  if (effectiveStr <= today) {
    await applyRevision(inserted.id, { actorId: actor.id, actorRole: actor.role, ipAddress });
  }
  return fetchRevision(inserted.id);
};

const cancelRevision = async ({ scopeIds, actor, ipAddress, id }) => {
  const { data, error } = await supabaseAdmin
    .from('salary_revisions')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: actor.id })
    .eq('id', id)
    .in('company_id', scopeIds)
    .eq('status', 'scheduled')
    .select('id, company_id, employee_id');
  if (error) throw new BadRequestError(error.message);
  if (!data?.length) throw new BadRequestError('Only a scheduled revision can be cancelled');

  require('./auditLog.service').logAudit({
    companyId: data[0].company_id,
    actorId: actor.id,
    actorRole: actor.role,
    actionType: 'salary_revision.cancel',
    targetType: 'employee',
    targetId: data[0].employee_id,
    afterState: { revision_id: id },
    ipAddress,
  }).catch((e) => logger.warn('Audit log failed', { error: e.message }));

  return fetchRevision(id);
};

/** Cron: apply every scheduled revision whose effective date has arrived. */
const applyDueRevisions = async () => {
  const { data, error } = await supabaseAdmin
    .from('salary_revisions')
    .select('id')
    .eq('status', 'scheduled')
    .lte('effective_date', todayIst())
    .order('effective_date', { ascending: true })
    .limit(500);
  if (error) throw error;

  let applied = 0;
  let failed = 0;
  for (const { id } of data || []) {
    try {
      if (await applyRevision(id)) applied += 1;
    } catch (err) {
      failed += 1;
      logger.error('[SalaryRevision] Scheduled apply failed', { revisionId: id, error: err.message });
    }
  }
  return { applied, failed };
};

module.exports = {
  SALARY_COMPONENTS,
  listRevisions,
  createRevision,
  cancelRevision,
  applyRevision,
  applyDueRevisions,
};
