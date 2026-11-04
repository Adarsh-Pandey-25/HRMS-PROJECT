/**
 * Loans and salary advances recovered through payroll (report Phase 4).
 * HR records the amount and the monthly instalment; each published payslip
 * recovers min(instalment, what is left), recorded once per payslip
 * (employee_loan_recoveries), and the loan closes when fully recovered.
 * Tables: SQL 20261103_employee_loans.sql. Nothing is sent to anyone.
 */
const { supabaseAdmin } = require('../config/supabase');
const {
  BadRequestError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const { toPaise, toRupees } = require('../payroll/money');

const LOANS = 'employee_loans';
const RECOVERIES = 'employee_loan_recoveries';
const MAX_AMOUNT = 1_00_00_000; // ₹1 crore

const notSetUp = () => new BadRequestError('Loans need a one-time database update — ask your administrator to run 20261103_employee_loans.sql.');
const tableMissing = (error) => /employee_loan/i.test(error?.message || '') && /(does not exist|schema cache)/i.test(error.message);
const check = (error) => {
  if (!error) return;
  if (tableMissing(error)) throw notSetUp();
  throw new BadRequestError(error.message);
};

const amount = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new BadRequestError(`${label} must be between ₹0.01 and ₹1 crore`);
  }
  return Math.round(n * 100) / 100;
};

/**
 * What each loan has had recovered, per the employee's published payslips
 * (what was actually deducted) — never less than the loan's own running
 * total. So a recovery whose bookkeeping failed after publishing can never
 * be taken a second time. { loan id: paise }.
 */
const recoveredByLoan = async (employeeId, loans) => {
  const out = new Map((loans || []).map((l) => [String(l.id), toPaise(l.recovered)]));
  if (!employeeId || !out.size) return out;
  const { data, error } = await supabaseAdmin
    .from('payroll').select('id, payslip_status, breakdown_json').eq('employee_id', employeeId).eq('payslip_status', 'PUBLISHED');
  if (error) throw new BadRequestError(error.message);
  const fromSlips = new Map();
  for (const r of data || []) {
    if (String(r.payslip_status || '').toUpperCase() !== 'PUBLISHED') continue;
    for (const l of r.breakdown_json?.config?.loans || []) {
      const id = String(l?.loan_id || '');
      if (out.has(id)) fromSlips.set(id, (fromSlips.get(id) || 0) + toPaise(l.amount));
    }
  }
  for (const [id, paise] of fromSlips) out.set(id, Math.max(out.get(id) || 0, paise));
  return out;
};

const toView = (row, recovered = toPaise(row.recovered)) => {
  const left = Math.max(0, toPaise(row.principal) - recovered);
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind,
    principal: Number(row.principal),
    instalment: Number(row.instalment),
    startMonth: row.start_month,
    startYear: row.start_year,
    recovered: toRupees(recovered),
    remaining: toRupees(left),
    status: row.status,
    note: row.note || null,
    createdAt: row.created_at,
  };
};

const employeeInCompany = async (employeeId, companyId) => {
  const { data, error } = await supabaseAdmin
    .from('employees').select('id, company_id').eq('id', employeeId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data || String(data.company_id) !== String(companyId)) throw new NotFoundError('Employee not found');
  return data;
};

/** An employee's loans and advances, newest first. */
const listLoans = async (companyId, employeeId) => {
  await employeeInCompany(employeeId, companyId);
  const { data, error } = await supabaseAdmin
    .from(LOANS).select('*').eq('employee_id', employeeId).order('created_at', { ascending: false });
  check(error);
  const recovered = await recoveredByLoan(employeeId, (data || []).filter((l) => l.status === 'active'));
  return (data || []).map((l) => toView(l, recovered.get(String(l.id)) ?? toPaise(l.recovered)));
};

/** HR records a loan or advance. Recovery starts with the payslip of startMonth/startYear. */
const createLoan = async ({
  companyId, employeeId, actor, kind = 'loan', principal, instalment, startMonth, startYear, note, ipAddress = null,
}) => {
  await employeeInCompany(employeeId, companyId);
  if (String(employeeId) === String(actor?.id)) {
    throw new ForbiddenError('You cannot add a loan for yourself — an admin has to.');
  }
  if (!['loan', 'advance'].includes(kind)) throw new BadRequestError('Kind must be loan or advance');
  const p = amount(principal, 'The amount');
  const i = amount(instalment, 'The monthly instalment');
  if (i > p) throw new BadRequestError('The monthly instalment can\'t be more than the amount');
  const m = Number(startMonth);
  const y = Number(startYear);
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) throw new BadRequestError('Choose the month recovery starts');
  const { data, error } = await supabaseAdmin.from(LOANS).insert({
    company_id: companyId,
    employee_id: employeeId,
    kind,
    principal: p,
    instalment: i,
    start_month: m,
    start_year: y,
    note: note ? String(note).trim().slice(0, 500) : null,
    created_by: actor?.id || null,
  }).select('*').maybeSingle();
  check(error);
  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.loan.create',
    targetType: 'employee',
    targetId: employeeId,
    afterState: {
      kind, principal: p, instalment: i, start: `${y}-${String(m).padStart(2, '0')}`,
    },
    ipAddress,
  }).catch(() => {});
  // Their open draft payslips start recovering it (drafts only; nothing is sent).
  require('../utils/background').runInBackground('drafts after a loan', () => require('./payroll.service')
    .recalculatePayslipsFromSettings({ employeeId, companyId }));
  return toView(data);
};

/** Cancel a loan entered by mistake — only before anything was recovered. */
const cancelLoan = async ({
  companyId, employeeId, loanId, actor, ipAddress = null,
}) => {
  await employeeInCompany(employeeId, companyId);
  const { data: row, error } = await supabaseAdmin.from(LOANS).select('*').eq('id', loanId).maybeSingle();
  check(error);
  if (!row || String(row.employee_id) !== String(employeeId)) throw new NotFoundError('Loan not found');
  if (row.status !== 'active') throw new ConflictError('Only an active loan can be cancelled');
  const recovered = (await recoveredByLoan(employeeId, [row])).get(String(row.id)) || 0;
  if (recovered > 0) {
    throw new ConflictError('Part of this loan has already been recovered through payroll, so it can\'t be cancelled.');
  }
  const { data, error: updErr } = await supabaseAdmin
    .from(LOANS).update({ status: 'cancelled' }).eq('id', loanId).eq('status', 'active').select('*').maybeSingle();
  check(updErr);
  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.loan.cancel',
    targetType: 'employee',
    targetId: employeeId,
    beforeState: { loan: loanId, principal: Number(row.principal) },
    ipAddress,
  }).catch(() => {});
  require('../utils/background').runInBackground('drafts after a loan', () => require('./payroll.service')
    .recalculatePayslipsFromSettings({ employeeId, companyId }));
  return toView(data || { ...row, status: 'cancelled' });
};

/**
 * What a payslip for month/year recovers: each active loan that has started,
 * min(instalment, what is left). In paise. [] when the tables don't exist yet.
 */
const recoveriesDue = async (employeeId, month, year, { finalPay = false } = {}) => {
  if (!employeeId) return [];
  const { data, error } = await supabaseAdmin
    .from(LOANS).select('*').eq('employee_id', employeeId).eq('status', 'active');
  if (error) {
    if (tableMissing(error)) return [];
    throw new BadRequestError(error.message);
  }
  const index = (y, m) => y * 12 + m;
  const started = (data || []).filter((l) => index(l.start_year, l.start_month) <= index(year, month));
  const recovered = await recoveredByLoan(employeeId, started);
  return started
    .map((l) => {
      const left = Math.max(0, toPaise(l.principal) - (recovered.get(String(l.id)) || 0));
      return {
        loanId: l.id,
        kind: l.kind,
        name: l.kind === 'advance' ? 'Salary advance recovery' : 'Loan recovery',
        // A leaver's final pay recovers all that is left (the payslip takes what its pay allows).
        amount: finalPay ? left : Math.min(toPaise(l.instalment), left),
      };
    })
    .filter((r) => r.amount > 0);
};

/**
 * On publishing: record each loan recovery on the payslip once, add it to
 * the loan, and close a loan that is fully recovered. `lines` are the
 * payslip's config.loans ([{ loan_id, amount }] in rupees).
 */
const recordRecoveries = async (payslip, lines) => {
  const done = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const paise = toPaise(line.amount);
    if (!line.loan_id || !(paise > 0)) continue;
    // eslint-disable-next-line no-await-in-loop
    const { error: insErr } = await supabaseAdmin.from(RECOVERIES).insert({
      loan_id: line.loan_id, payroll_id: payslip.id, month: payslip.month, year: payslip.year, amount: toRupees(paise),
    });
    if (insErr) {
      if (/duplicate|unique/i.test(insErr.message || '')) continue; // already recorded for this payslip
      throw new BadRequestError(insErr.message);
    }
    // eslint-disable-next-line no-await-in-loop
    const { data: loan, error } = await supabaseAdmin.from(LOANS).select('*').eq('id', line.loan_id).maybeSingle();
    if (error) throw new BadRequestError(error.message);
    if (!loan) continue;
    // The total from the recoveries themselves, so two payslips published at
    // once can't overwrite each other's share.
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error: sumErr } = await supabaseAdmin.from(RECOVERIES).select('amount').eq('loan_id', loan.id);
    if (sumErr) throw new BadRequestError(sumErr.message);
    const recovered = (rows || []).reduce((s, r) => s + toPaise(r.amount), 0);
    const closed = recovered >= toPaise(loan.principal);
    // eslint-disable-next-line no-await-in-loop
    const { error: updErr } = await supabaseAdmin.from(LOANS).update({
      recovered: toRupees(recovered), ...(closed ? { status: 'closed' } : {}),
    }).eq('id', loan.id);
    if (updErr) throw new BadRequestError(updErr.message);
    done.push({ loan_id: loan.id, amount: toRupees(paise), closed });
  }
  return done;
};

module.exports = {
  listLoans, createLoan, cancelLoan, recoveriesDue, recordRecoveries,
};
