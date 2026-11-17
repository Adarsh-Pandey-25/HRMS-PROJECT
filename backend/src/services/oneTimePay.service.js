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
  BadRequestError, NotFoundError, ConflictError,
} = require('../utils/errors');
const { toPaise } = require('../payroll/money');
const ownPay = require('./ownPayslip');

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
// The tax-free part of an item (exempt_amount): SQL 20261117_fnf_exemption_used.sql.
const exemptColumnMissing = (error) => /exempt_amount/i.test(error?.message || '') && /(does not exist|schema cache)/i.test(error.message);
const check = (error) => {
  if (!error) return;
  if (tableMissing(error)) throw notSetUp();
  throw new BadRequestError(error.message);
};

/** The tax-free part of a taxable earning, in rupees (0 when none, or when the whole item isn't taxable). */
const exemptOf = (row) => (KINDS[row.kind]?.earning && row.taxable !== false
  ? Math.min(Number(row.amount) || 0, Math.max(0, Number(row.exempt_amount) || 0))
  : 0);

const toView = (row) => {
  const exempt = exemptOf(row);
  return {
    id: row.id,
    employeeId: row.employee_id,
    month: row.month,
    year: row.year,
    kind: row.kind,
    earning: Boolean(KINDS[row.kind]?.earning),
    name: row.name,
    amount: Number(row.amount),
    taxable: row.taxable !== false,
    // Part of it tax-free (gratuity, leave encashment on leaving): both parts.
    ...(exempt > 0 ? {
      exemptAmount: exempt,
      taxableAmount: Math.round((Number(row.amount) - exempt) * 100) / 100,
    } : {}),
    pfWage: row.pf_wage === true,
    esiWage: row.esi_wage === true,
    source: row.source,
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

/**
 * Works out the employee's draft payslips again with their one-time pay.
 * `edited` ({ by, month, year }): the person whose change it is — they
 * become that month's draft's last editor, so they can't approve it.
 */
const recalculateDrafts = (employeeId, companyId, edited = null) => require('../utils/background').runInBackground(
  'drafts after one-time pay',
  () => require('./payroll.service').recalculatePayslipsFromSettings({ employeeId, companyId, edited }),
);

/**
 * HR adds one-time pay or a recovery to a month's payslip. `exemptAmount`
 * (rupees): the tax-free part of a taxable earning — the full and final
 * settlement's gratuity and leave encashment up to their legal limits; TDS
 * is worked out on the rest.
 */
const createItem = async ({
  companyId, employeeId, actor, month, year, kind, name, amount, taxable, pfWage, esiWage, note, source = 'manual', ipAddress = null,
  recalculate = true, exemptAmount = null,
}) => {
  await employeeInCompany(employeeId, companyId);
  // HR can't add pay for themselves — an Admin must (an Admin's own is audit-logged).
  const adminOwn = ownPay.assertNotOwnPay(actor, employeeId, `You can't add pay for yourself. ${ownPay.OWN_PAYSLIP_MESSAGE}`);
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
  const rupees = Math.round(n * 100) / 100;
  const isTaxable = def.earning ? flag(taxable, def.taxable) : false;
  // The tax-free part: only of a taxable earning, and never more than the item.
  let exempt = 0;
  if (exemptAmount != null && exemptAmount !== '' && isTaxable) {
    exempt = Number(exemptAmount);
    if (!Number.isFinite(exempt) || exempt < 0 || exempt > rupees || Math.abs(exempt * 100 - Math.round(exempt * 100)) > 1e-6) {
      throw new BadRequestError('The tax-free part must be between ₹0 and the amount');
    }
    exempt = Math.round(exempt * 100) / 100;
  }
  await assertMonthOpen(employeeId, m, y);
  // Only a month the employee is paid in: one they worked in, or the month
  // after their last (a settlement payslip for full and final).
  await assertPayableMonth(employeeId, m, y);
  const row = {
    company_id: companyId,
    employee_id: employeeId,
    month: m,
    year: y,
    kind,
    name: label,
    amount: rupees,
    // Recoveries are never pay: not taxable, no PF or ESI.
    taxable: isTaxable,
    pf_wage: def.earning ? flag(pfWage, def.pfWage) : false,
    esi_wage: def.earning ? flag(esiWage, def.esiWage) : false,
    source: source === 'fnf' ? 'fnf' : 'manual',
    note: note ? String(note).trim().slice(0, 500) : null,
    created_by: actor?.id || null,
    // Sent only when there is a tax-free part, so everything else works before its SQL is run.
    ...(exempt > 0 ? { exempt_amount: exempt } : {}),
  };
  const insertOne = (r) => supabaseAdmin.from(TABLE).insert(r).select('*').maybeSingle();
  let { data, error } = await insertOne(row);
  let parts = null;
  if (error && exempt > 0 && exemptColumnMissing(error)) {
    // Before 20261117_fnf_exemption_used.sql is run: the tax-free part and the
    // taxable part go on as two items, so the tax is still right.
    const base = { ...row };
    delete base.exempt_amount;
    parts = [];
    const taxablePart = Math.round((rupees - exempt) * 100) / 100;
    for (const part of [
      { ...base, name: `${label} (exempt)`.slice(0, 80), amount: exempt, taxable: false },
      ...(taxablePart > 0 ? [{ ...base, name: `${label} (taxable)`.slice(0, 80), amount: taxablePart }] : []),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      ({ data, error } = await insertOne(part));
      if (error) break;
      parts.push(data);
    }
  }
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
      kind, name: label, amount: rupees, ...(exempt > 0 ? { exempt_amount: exempt } : {}), month: `${y}-${String(m).padStart(2, '0')}`, source,
    },
    ipAddress,
  }).catch(() => {});
  if (adminOwn) ownPay.logOwnPayAction(actor, 'one_time.create', { kind, amount: rupees, month: m, year: y }, ipAddress);
  if (recalculate) recalculateDrafts(employeeId, companyId, { by: actor?.id || null, month: m, year: y });
  if (parts) {
    // The whole item as asked for, and the two items it went on as.
    return {
      ...toView(parts[0]),
      name: label,
      amount: rupees,
      taxable: true,
      exemptAmount: exempt,
      taxableAmount: Math.round((rupees - exempt) * 100) / 100,
      parts: parts.map(toView),
    };
  }
  return toView(data);
};

/** Cancel an item, while its month's payslip isn't published. */
const cancelItem = async ({
  companyId, employeeId, itemId, actor, ipAddress = null,
}) => {
  await employeeInCompany(employeeId, companyId);
  const adminOwn = ownPay.assertNotOwnPay(actor, employeeId, `You can't change your own pay. ${ownPay.OWN_PAYSLIP_MESSAGE}`);
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
  if (adminOwn) ownPay.logOwnPayAction(actor, 'one_time.cancel', { item: itemId, kind: row.kind, month: row.month, year: row.year }, ipAddress);
  recalculateDrafts(employeeId, companyId, { by: actor?.id || null, month: row.month, year: row.year });
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
    .map((r) => {
      // The tax-free part of a taxable earning (paise): TDS is worked out on the rest.
      const exempt = toPaise(exemptOf(r));
      return {
        id: r.id,
        kind: r.kind,
        name: r.name,
        earning: KINDS[r.kind].earning,
        amount: toPaise(r.amount),
        taxable: KINDS[r.kind].earning && r.taxable !== false,
        ...(exempt > 0 ? { exempt } : {}),
        pfWage: KINDS[r.kind].earning && r.pf_wage === true,
        esiWage: KINDS[r.kind].earning && r.esi_wage === true,
      };
    });
};

/**
 * Who added the active one-time pay on an employee's month (maker-checker:
 * they changed that payslip, so they can't approve it). [] when the table
 * doesn't exist yet.
 */
const itemMakers = async (employeeId, month, year) => {
  if (!employeeId || !month || !year) return [];
  const { data, error } = await supabaseAdmin
    .from(TABLE).select('created_by').eq('employee_id', employeeId).eq('month', month).eq('year', year).eq('status', 'active');
  if (error) {
    if (tableMissing(error)) return [];
    throw new BadRequestError(error.message);
  }
  return [...new Set((data || []).map((r) => r.created_by).filter(Boolean).map(String))];
};

module.exports = {
  KINDS, listItems, createItem, cancelItem, cancelSource, itemsDue, itemMakers, recalculateDrafts,
};
