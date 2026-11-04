/**
 * One-time pay and recoveries on a month's payslip (report Phase 4): arrears,
 * bonus, incentives, leave encashment, gratuity, pay in lieu of notice, and
 * recoveries such as notice not served. HR adds them per employee and month
 * (or the full and final settlement does); the month's draft payslip
 * includes them; the TDS on them is worked out by the difference method
 * (payroll/tds.js). A month whose payslip is published can't change.
 * Table: SQL 20261104_payroll_one_time_items.sql. Nothing is sent to anyone.
 */
const { supabaseAdmin } = require('../config/supabase');
const {
  BadRequestError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const { toPaise } = require('../payroll/money');

const TABLE = 'payroll_one_time_items';
const MAX_AMOUNT = 1_00_00_000; // ₹1 crore

/**
 * Each kind, whether it is paid or recovered, and what it counts for by
 * default — HR can change taxable / PF / ESI per item.
 *   pfWage  arrears of wages (Basic + DA) attract PF
 *   esiWage pay for work done in the month counts for ESI; annual bonus,
 *           encashment, gratuity and notice pay do not
 */
const KINDS = {
  arrears: { label: 'Arrears', earning: true, taxable: true, pfWage: true, esiWage: true },
  bonus: { label: 'Bonus', earning: true, taxable: true, pfWage: false, esiWage: false },
  incentive: { label: 'Incentive', earning: true, taxable: true, pfWage: false, esiWage: true },
  leave_encashment: { label: 'Leave encashment', earning: true, taxable: true, pfWage: false, esiWage: false },
  gratuity: { label: 'Gratuity', earning: true, taxable: true, pfWage: false, esiWage: false },
  notice_pay: { label: 'Pay in lieu of notice', earning: true, taxable: true, pfWage: false, esiWage: false },
  other_earning: { label: 'Other earning', earning: true, taxable: true, pfWage: false, esiWage: false },
  notice_recovery: { label: 'Notice period not served', earning: false, taxable: false, pfWage: false, esiWage: false },
  other_deduction: { label: 'Other recovery', earning: false, taxable: false, pfWage: false, esiWage: false },
};

/** Names payroll's own lines use: a one-time item named so would be mixed up with them. */
const RESERVED_NAMES = new Set([
  'basic', 'basic salary', 'hra', 'da', 'special allowance', 'transport allowance', 'medical allowance', 'overtime',
  'pf', 'vpf', 'esi', 'professional tax', 'pt', 'tds', 'labour welfare fund', 'lwf',
  'loan recovery', 'salary advance recovery', 'employer pf — pension (eps)', 'employer pf — epf', 'edli',
  'epf admin charges', 'employer esi', 'employer lwf',
]);

const notSetUp = () => new BadRequestError('One-time pay needs a one-time database update — ask your administrator to run 20261104_payroll_one_time_items.sql.');
const tableMissing = (error) => /payroll_one_time_items/i.test(error?.message || '') && /(does not exist|schema cache)/i.test(error.message);
const check = (error) => {
  if (!error) return;
  if (tableMissing(error)) throw notSetUp();
  throw new BadRequestError(error.message);
};

const toView = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  month: row.month,
  year: row.year,
  kind: row.kind,
  earning: Boolean(KINDS[row.kind]?.earning),
  name: row.name,
  amount: Number(row.amount),
  taxable: row.taxable !== false,
  pfWage: row.pf_wage === true,
  esiWage: row.esi_wage === true,
  source: row.source,
  status: row.status,
  note: row.note || null,
  createdAt: row.created_at,
});

const employeeInCompany = async (employeeId, companyId) => {
  const { data, error } = await supabaseAdmin
    .from('employees').select('id, company_id').eq('id', employeeId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data || String(data.company_id) !== String(companyId)) throw new NotFoundError('Employee not found');
  return data;
};

/** A month whose payslip is already published can't take new items (it never changes). */
const assertMonthOpen = async (employeeId, month, year) => {
  const { data, error } = await supabaseAdmin
    .from('payroll').select('id, payslip_status').eq('employee_id', employeeId).eq('month', month).eq('year', year);
  if (error) throw new BadRequestError(error.message);
  if ((data || []).some((r) => String(r.payslip_status || '').toUpperCase() === 'PUBLISHED')) {
    throw new ConflictError('That month\'s payslip is already published — add it to the next month instead.');
  }
};

/** Refuses a month the employee can't be paid in (before joining, or after the month after leaving). */
const assertPayableMonth = async (employeeId, month, year) => {
  const payroll = require('./payroll.service');
  const { data: employee, error } = await supabaseAdmin.from('employees').select('*').eq('id', employeeId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!employee) throw new NotFoundError('Employee not found');
  if (payroll.employmentInMonth(employee, month, year).employed) return;
  if (payroll.isSettlementMonth(employee, month, year)) return;
  const lwd = payroll.lastWorkingDayOf(employee);
  throw new BadRequestError(lwd
    ? `They left on ${lwd} — one-time pay can go on that month's payslip or the next one only.`
    : 'They aren\'t employed in that month.');
};

const monthYear = (month, year) => {
  const m = Number(month);
  const y = Number(year);
  if (!(Number.isInteger(m) && m >= 1 && m <= 12) || !(Number.isInteger(y) && y >= 2000 && y <= 2100)) {
    throw new BadRequestError('Choose the payslip month');
  }
  return { m, y };
};

/** An employee's one-time items, newest month first (a month, if given). */
const listItems = async (companyId, employeeId, { month = null, year = null } = {}) => {
  await employeeInCompany(employeeId, companyId);
  let q = supabaseAdmin.from(TABLE).select('*').eq('employee_id', employeeId);
  if (month && year) {
    const { m, y } = monthYear(month, year);
    q = q.eq('month', m).eq('year', y);
  }
  const { data, error } = await q.order('year', { ascending: false }).order('month', { ascending: false });
  check(error);
  return (data || []).map(toView);
};

const recalculateDrafts = (employeeId, companyId) => require('../utils/background').runInBackground(
  'drafts after one-time pay',
  () => require('./payroll.service').recalculatePayslipsFromSettings({ employeeId, companyId }),
);

/** HR adds one-time pay or a recovery to a month's payslip. */
const createItem = async ({
  companyId, employeeId, actor, month, year, kind, name, amount, taxable, pfWage, esiWage, note, source = 'manual', ipAddress = null,
  recalculate = true,
}) => {
  await employeeInCompany(employeeId, companyId);
  if (String(employeeId) === String(actor?.id)) {
    throw new ForbiddenError('You cannot add pay for yourself — an admin has to.');
  }
  const def = KINDS[kind];
  if (!def) throw new BadRequestError('Choose what kind of pay or recovery this is');
  const { m, y } = monthYear(month, year);
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new BadRequestError('The amount must be between ₹0.01 and ₹1 crore');
  }
  const label = String(name ?? '').trim().slice(0, 80) || def.label;
  if (RESERVED_NAMES.has(label.toLowerCase())) {
    throw new BadRequestError(`Give it a name of its own — "${label}" is a regular payslip line`);
  }
  const flag = (v, d) => (typeof v === 'boolean' ? v : d);
  await assertMonthOpen(employeeId, m, y);
  // Only a month the employee is paid in: one they worked in, or the month
  // after their last (a settlement payslip for full and final).
  await assertPayableMonth(employeeId, m, y);
  const { data, error } = await supabaseAdmin.from(TABLE).insert({
    company_id: companyId,
    employee_id: employeeId,
    month: m,
    year: y,
    kind,
    name: label,
    amount: Math.round(n * 100) / 100,
    // Recoveries are never pay: not taxable, no PF or ESI.
    taxable: def.earning ? flag(taxable, def.taxable) : false,
    pf_wage: def.earning ? flag(pfWage, def.pfWage) : false,
    esi_wage: def.earning ? flag(esiWage, def.esiWage) : false,
    source: source === 'fnf' ? 'fnf' : 'manual',
    note: note ? String(note).trim().slice(0, 500) : null,
    created_by: actor?.id || null,
  }).select('*').maybeSingle();
  if (error && /duplicate|unique/i.test(error.message || '')) {
    throw new ConflictError('That item is already on this payslip.');
  }
  check(error);
  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.one_time.create',
    targetType: 'employee',
    targetId: employeeId,
    afterState: {
      kind, name: label, amount: Math.round(n * 100) / 100, month: `${y}-${String(m).padStart(2, '0')}`, source,
    },
    ipAddress,
  }).catch(() => {});
  if (recalculate) recalculateDrafts(employeeId, companyId);
  return toView(data);
};

/** Cancel an item, while its month's payslip isn't published. */
const cancelItem = async ({
  companyId, employeeId, itemId, actor, ipAddress = null,
}) => {
  await employeeInCompany(employeeId, companyId);
  if (String(employeeId) === String(actor?.id)) {
    throw new ForbiddenError('You cannot change your own pay — an admin has to.');
  }
  const { data: row, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', itemId).maybeSingle();
  check(error);
  if (!row || String(row.employee_id) !== String(employeeId)) throw new NotFoundError('Item not found');
  if (row.status !== 'active') throw new ConflictError('It is already cancelled');
  await assertMonthOpen(employeeId, row.month, row.year);
  const { data, error: updErr } = await supabaseAdmin
    .from(TABLE).update({ status: 'cancelled' }).eq('id', itemId).eq('status', 'active').select('*').maybeSingle();
  check(updErr);
  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.one_time.cancel',
    targetType: 'employee',
    targetId: employeeId,
    beforeState: { item: itemId, kind: row.kind, amount: Number(row.amount), month: `${row.year}-${String(row.month).padStart(2, '0')}` },
    ipAddress,
  }).catch(() => {});
  recalculateDrafts(employeeId, companyId);
  return toView(data || { ...row, status: 'cancelled' });
};

/**
 * Cancel every active item a source added to a month (e.g. a full and final
 * settlement worked out again). The month's payslip must not be published.
 */
const cancelSource = async ({
  companyId, employeeId, month, year, source, actor, ipAddress = null,
}) => {
  await employeeInCompany(employeeId, companyId);
  const { m, y } = monthYear(month, year);
  await assertMonthOpen(employeeId, m, y);
  const { data, error } = await supabaseAdmin
    .from(TABLE).update({ status: 'cancelled' })
    .eq('employee_id', employeeId).eq('month', m).eq('year', y).eq('source', source).eq('status', 'active')
    .select('id');
  check(error);
  if ((data || []).length) {
    require('./auditLog.service').logAudit({
      companyId,
      actorId: actor?.id || null,
      actorRole: actor?.role || null,
      actionType: 'payroll.one_time.cancel',
      targetType: 'employee',
      targetId: employeeId,
      beforeState: { source, month: `${y}-${String(m).padStart(2, '0')}`, items: data.length },
      ipAddress,
    }).catch(() => {});
  }
  return (data || []).length;
};

/**
 * The active items of a month, as payroll uses them (paise). [] when the
 * table doesn't exist yet.
 */
const itemsDue = async (employeeId, month, year) => {
  if (!employeeId || !month || !year) return [];
  const { data, error } = await supabaseAdmin
    .from(TABLE).select('*').eq('employee_id', employeeId).eq('month', month).eq('year', year).eq('status', 'active');
  if (error) {
    if (tableMissing(error)) return [];
    throw new BadRequestError(error.message);
  }
  return (data || [])
    .filter((r) => KINDS[r.kind] && toPaise(r.amount) > 0)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      earning: KINDS[r.kind].earning,
      amount: toPaise(r.amount),
      taxable: KINDS[r.kind].earning && r.taxable !== false,
      pfWage: KINDS[r.kind].earning && r.pf_wage === true,
      esiWage: KINDS[r.kind].earning && r.esi_wage === true,
    }));
};

module.exports = {
  KINDS, listItems, createItem, cancelItem, cancelSource, itemsDue, recalculateDrafts,
};
