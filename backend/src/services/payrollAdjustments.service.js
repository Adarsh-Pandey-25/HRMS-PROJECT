/**
 * Changes after publishing (report defect D9; master prompt: corrections only
 * as arrears or adjustments in a later run). Last month's published payslips
 * are worked out again with today's attendance and salary history — read-only,
 * the casual leave applied when they were published kept as it was. Any
 * difference in pay (an absence corrected, a back-dated raise) is offered as
 * arrears or a recovery on this month's payslip; a published payslip itself
 * never changes. Nothing is sent to anyone.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { toPaise, toRupees } = require('../payroll/money');

const monthBefore = (month, year) => (month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year });
const labelOf = (month, year) => moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).format('MMMM YYYY');
const checkMonth = (month, year) => {
  const m = Number(month);
  const y = Number(year);
  if (!(Number.isInteger(m) && m >= 1 && m <= 12) || !(Number.isInteger(y) && y >= 2000 && y <= 2100)) {
    throw new BadRequestError('month and year are required');
  }
  return { m, y };
};
/** The regular pay a payslip worked out (earned parts + overtime), and its PF wages without one-time pay. */
const regularOf = (cfg = {}) => {
  const oneTimeWages = (cfg.one_time || []).filter((i) => i.earning && i.pf_wage).reduce((s, i) => s + toPaise(i.amount), 0);
  return {
    pay: toPaise(cfg.earned_gross) + toPaise(cfg.overtime?.pay),
    wages: Math.max(0, toPaise(cfg.pf_wages) - oneTimeWages),
    paidDays: Number(cfg.paid_days ?? 0),
  };
};
const itemNames = (prevLabel) => ({
  wages: `Arrears for ${prevLabel}`,
  other: `Arrears for ${prevLabel} (other pay)`,
  recovery: `Overpaid in ${prevLabel}`,
});

/**
 * For the month being run (month/year): last month's published payslips whose
 * pay comes out different today. Read-only.
 */
const findAdjustments = async (companyId, month, year) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const { m, y } = checkMonth(month, year);
  const prev = monthBefore(m, y);
  const prevLabel = labelOf(prev.month, prev.year);
  const payroll = require('./payroll.service');
  const attendance = require('./attendance.service');
  const { data: slips, error } = await supabaseAdmin
    .from('payroll')
    .select('id, employee_id, month, year, payslip_status, breakdown_json, company_id')
    .eq('company_id', companyId)
    .eq('month', prev.month)
    .eq('year', prev.year)
    .eq('payslip_status', 'PUBLISHED');
  if (error) throw new BadRequestError(error.message);
  const published = (slips || []).filter((r) => String(r.payslip_status || '').toUpperCase() === 'PUBLISHED'
    && String(r.company_id) === String(companyId) && r.breakdown_json?.config?.engine === 2);
  if (!published.length) return { month: m, year: y, from: prev, items: [] };

  const ctx = await payroll.loadPayrollContext(companyId);
  const names = itemNames(prevLabel);
  const items = [];
  for (const slip of published) {
    // eslint-disable-next-line no-await-in-loop
    const { data: employee } = await supabaseAdmin.from('employees').select('*').eq('id', slip.employee_id).maybeSingle();
    if (!employee || String(employee.company_id) !== String(companyId)) continue;
    const employment = payroll.employmentInMonth(employee, prev.month, prev.year);
    if (!employment.employed) continue;
    // eslint-disable-next-line no-await-in-loop
    const { summary, records } = await attendance.getMonthlySummary(employee.id, prev.month, prev.year, { lastWorkingDay: employment.lastWorkingDay });
    // eslint-disable-next-line no-await-in-loop
    const now = await payroll.calculateContractPayslip(employee, summary, prev.month, {
      year: prev.year, records, ctx, withHistory: true, published: true, previousConfig: slip.breakdown_json.config,
    });
    const then = regularOf(slip.breakdown_json.config);
    const today = regularOf(now.breakdown_json.config);
    const difference = today.pay - then.pay;
    if (Math.abs(difference) < 100) continue; // under a rupee: nothing to settle
    // Already added to this month's payslip?
    // eslint-disable-next-line no-await-in-loop
    const due = await require('./oneTimePay.service').itemsDue(employee.id, m, y);
    const added = due.some((i) => Object.values(names).includes(i.name));
    items.push({
      employeeId: employee.id,
      name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.employee_code || 'Employee',
      paidDaysThen: then.paidDays,
      paidDaysNow: today.paidDays,
      paidThen: toRupees(then.pay),
      paidNow: toRupees(today.pay),
      difference: toRupees(difference),
      wagesDifference: toRupees(today.wages - then.wages),
      added,
    });
  }
  return { month: m, year: y, from: prev, items };
};

/**
 * Add the differences to this month's payslips: arrears (the wages part counts
 * for PF; both count for ESI) or a recovery of what was overpaid. Skips anyone
 * already done, and anyone not chosen.
 */
const applyAdjustments = async ({
  companyId, month, year, employeeIds, actor, ipAddress = null,
}) => {
  const found = await findAdjustments(companyId, month, year);
  const wanted = new Set((Array.isArray(employeeIds) ? employeeIds : []).map(String));
  const oneTime = require('./oneTimePay.service');
  const names = itemNames(labelOf(found.from.month, found.from.year));
  const done = [];
  const skipped = [];
  for (const a of found.items) {
    if (!wanted.has(String(a.employeeId))) continue;
    if (a.added) {
      skipped.push({ employeeId: a.employeeId, reason: 'Already added to this month' });
      continue;
    }
    const diff = toPaise(a.difference);
    const items = [];
    if (diff > 0) {
      const wages = Math.min(diff, Math.max(0, toPaise(a.wagesDifference)));
      if (wages > 0) items.push({ kind: 'arrears', name: names.wages, amount: wages, pfWage: true, esiWage: true });
      if (diff - wages > 0) items.push({ kind: 'arrears', name: names.other, amount: diff - wages, pfWage: false, esiWage: true });
    } else {
      items.push({ kind: 'other_deduction', name: names.recovery, amount: -diff });
    }
    try {
      for (const i of items) {
        // eslint-disable-next-line no-await-in-loop
        await oneTime.createItem({
          companyId,
          employeeId: a.employeeId,
          actor,
          month: found.month,
          year: found.year,
          kind: i.kind,
          name: i.name,
          amount: toRupees(i.amount),
          pfWage: i.pfWage,
          esiWage: i.esiWage,
          note: `Pay for ${labelOf(found.from.month, found.from.year)} worked out again: ${a.paidDaysThen} → ${a.paidDaysNow} paid days`,
          ipAddress,
          recalculate: false,
        });
      }
      oneTime.recalculateDrafts(a.employeeId, companyId);
      done.push({ employeeId: a.employeeId, difference: a.difference });
    } catch (err) {
      skipped.push({ employeeId: a.employeeId, reason: err.message });
    }
  }
  return { added: done, skipped };
};

module.exports = { findAdjustments, applyAdjustments };
