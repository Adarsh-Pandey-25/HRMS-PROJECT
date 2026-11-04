/**
 * Full and final settlement for someone who has left (report Phase 4):
 * gratuity, leave encashment, notice pay and the statutory bonus for the
 * accounting year so far (payroll/fullAndFinal.js), worked out from their
 * record with the company's own values, and added as one-time pay to the
 * payslip of their last month. That payslip can be made as soon as the last
 * working day is over — final dues are payable within 2 working days (Code
 * on Wages s.17). HR reviews and publishes it as usual. Nothing is sent.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { toPaise, toRupees } = require('../payroll/money');
const { computeFullAndFinal, NOTICE_ACTIONS } = require('../payroll/fullAndFinal');
const companyRules = require('../payroll/companyRules');

/** The one-time pay kind each settlement item is paid as. */
const KIND_OF = {
  GRATUITY: 'gratuity',
  LEAVE_ENCASHMENT: 'leave_encashment',
  NOTICE_PAY: 'notice_pay',
  NOTICE_RECOVERY: 'notice_recovery',
  BONUS: 'bonus',
};

/** The month the settlement is paid in: the last month, or the next one if the last month's payslip is published. */
const settlementPayslipMonth = async (employeeId, month, year) => {
  const { data, error } = await supabaseAdmin
    .from('payroll').select('payslip_status').eq('employee_id', employeeId).eq('month', month).eq('year', year);
  if (error) throw new BadRequestError(error.message);
  const published = (data || []).some((r) => String(r.payslip_status || '').toUpperCase() === 'PUBLISHED');
  if (!published) return { month, year, settlement: false };
  return month === 12 ? { month: 1, year: year + 1, settlement: true } : { month: month + 1, year, settlement: true };
};

const loadLeaver = async (companyId, employeeId) => {
  const payroll = require('./payroll.service');
  const { data: employee, error } = await supabaseAdmin.from('employees').select('*').eq('id', employeeId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!employee || String(employee.company_id) !== String(companyId)) throw new NotFoundError('Employee not found');
  const lastWorkingDay = payroll.lastWorkingDayOf(employee);
  if (!lastWorkingDay) throw new BadRequestError('Record their last working day first (Offboard, on their profile).');
  return { employee, lastWorkingDay };
};

/** HR's inputs, checked: leave days to encash, notice, fixed-term, bonus. */
const cleanInputs = (raw = {}) => {
  const leaveDays = Number(raw.leaveDays ?? 0);
  if (!Number.isFinite(leaveDays) || leaveDays < 0 || leaveDays > 1000 || Math.round(leaveDays * 2) !== leaveDays * 2) {
    throw new BadRequestError('Leave days to encash: 0 or more, in half days');
  }
  let notice = null;
  if (raw.notice && raw.notice.action && raw.notice.action !== 'waive') {
    const n = raw.notice;
    if (!NOTICE_ACTIONS.includes(n.action)) throw new BadRequestError('Notice: recover, pay or waive');
    const days = (v) => {
      const d = Number(v);
      if (!Number.isInteger(d) || d < 0 || d > 365) throw new BadRequestError('Notice days: whole days, 0 to 365');
      return d;
    };
    const divisor = n.divisor == null ? 30 : Number(n.divisor);
    if (!Number.isInteger(divisor) || divisor < 1 || divisor > 31) throw new BadRequestError('Notice: divide a month\'s pay by 1 to 31 days');
    notice = {
      requiredDays: days(n.requiredDays), servedDays: days(n.servedDays), action: n.action, base: n.base === 'basic_da' ? 'basic_da' : 'gross', divisor,
    };
  }
  return {
    leaveDays, notice, fixedTerm: raw.fixedTerm === true, includeBonus: raw.includeBonus !== false,
  };
};

/** The statutory bonus's months: April of the accounting year to the leaving month, each month's Labour Code wages. */
const bonusMonthsFor = async (employeeId, month, year, finalMonthWages) => {
  const startYear = month >= 4 ? year : year - 1;
  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select('month, year, payslip_status, breakdown_json, basic_salary')
    .eq('employee_id', employeeId)
    .in('year', [startYear, startYear + 1]);
  if (error) throw new BadRequestError(error.message);
  const index = (y, m) => y * 12 + m;
  const from = index(startYear, 4);
  const to = index(year, month);
  const months = (data || [])
    .filter((r) => String(r.payslip_status || '').toUpperCase() === 'PUBLISHED')
    .filter((r) => index(Number(r.year), Number(r.month)) >= from && index(Number(r.year), Number(r.month)) < to)
    // Each month's regular wages (the one-time pay counted for PF, e.g. arrears, is not bonus wages twice).
    .map((r) => {
      const cfg = r.breakdown_json?.config || {};
      // A payslip from before wages were stored: its earned Basic + DA.
      if (cfg.pf_wages == null) {
        const da = (r.breakdown_json?.earnings || []).find((e) => String(e?.name || '').trim().toLowerCase() === 'da');
        return { wages: toPaise(r.basic_salary) + toPaise(da?.amount) };
      }
      const oneTimeWages = (cfg.one_time || []).filter((i) => i.earning && i.pf_wage).reduce((s, i) => s + toPaise(i.amount), 0);
      return { wages: Math.max(0, toPaise(cfg.pf_wages) - oneTimeWages) };
    });
  months.push({ wages: finalMonthWages });
  return months;
};

/**
 * What the settlement comes to, for HR to review before adding it to the
 * final payslip. Read-only.
 */
const previewFullAndFinal = async ({ companyId, employeeId, inputs }) => {
  const payroll = require('./payroll.service');
  const attendance = require('./attendance.service');
  const { employee, lastWorkingDay } = await loadLeaver(companyId, employeeId);
  const p = cleanInputs(inputs);
  const month = Number(lastWorkingDay.slice(5, 7));
  const year = Number(lastWorkingDay.slice(0, 4));
  const ctx = await payroll.loadPayrollContext(companyId);
  // Paid with the final payslip — or, once that is published, a settlement payslip the month after.
  const payOn = await settlementPayslipMonth(employeeId, month, year);

  // The last drawn monthly figures: a full month at today's salary.
  const full = payroll.computePayslip(ctx, { employee: { ...employee, last_working_day: null }, summary: {}, records: [], month, year });
  const fullCfg = full.breakdown_json.config;
  const rateOf = (name) => Number(full.breakdown_json.earnings.find((e) => e.name === name)?.rate || 0);
  const monthlyBasicDa = toPaise(rateOf('Basic') + rateOf('DA'));
  const monthlyWages = toPaise(fullCfg.pf_wages);
  const monthlyGross = toPaise(fullCfg.contract_gross);

  // The final month's own wages (to the last working day), for the bonus.
  let bonusMonths = null;
  if (p.includeBonus) {
    // As the final payslip will work it out (salary history included), less any
    // one-time pay counted for PF (arrears are not bonus wages twice).
    const { summary, records } = await attendance.getMonthlySummary(employeeId, month, year, { lastWorkingDay });
    const finalMonth = await payroll.calculateContractPayslip(employee, summary, month, {
      year, records, ctx, withHistory: true,
    });
    const fcfg = finalMonth.breakdown_json.config;
    const oneTimeWages = (fcfg.one_time || []).filter((i) => i.earning && i.pf_wage).reduce((s, i) => s + toPaise(i.amount), 0);
    bonusMonths = await bonusMonthsFor(employeeId, month, year, Math.max(0, toPaise(fcfg.pf_wages) - oneTimeWages));
  }

  const result = computeFullAndFinal({
    joinedOn: employee.date_of_joining ? String(employee.date_of_joining).slice(0, 10) : null,
    lastWorkingDay,
    fixedTerm: p.fixedTerm,
    monthlyBasicDa,
    monthlyWages,
    monthlyGross,
    leaveDays: p.leaveDays,
    notice: p.notice,
    bonusMonths,
    calc: ctx.calc,
  });

  // Leave balances this year, for reference (HR decides what is encashable).
  const { data: balances } = await supabaseAdmin
    .from('leave_balances')
    .select('leave_type, total_allocated, used, encashed')
    .eq('employee_id', employeeId)
    .eq('year', year);

  // Outstanding loans: the final payslip recovers what its pay allows; the rest is listed.
  const loansLeft = await require('./employeeLoan.service').recoveriesDue(employeeId, payOn.month, payOn.year, { finalPay: true });
  const notes = [...result.notes];
  if (loansLeft.length) {
    notes.push(`Loans and advances still owed: ${loansLeft.map((l) => `${l.name} ₹${toRupees(l.amount).toLocaleString('en-IN')}`).join(', ')} — the payslip recovers what its pay allows; anything more must be recovered another way.`);
  }
  const today = moment.tz(TIMEZONE).format('YYYY-MM-DD');
  return {
    employeeId,
    lastWorkingDay,
    // The payslip the settlement goes on (a settlement payslip if the last month's is published).
    month: payOn.month,
    year: payOn.year,
    settlementPayslip: payOn.settlement,
    // Final dues within 2 working days: the final payslip can be made once the last day is over.
    canGenerate: lastWorkingDay < today,
    inputs: p,
    monthly: { basicDa: toRupees(monthlyBasicDa), wages: toRupees(monthlyWages), gross: toRupees(monthlyGross) },
    items: result.items.map((i) => ({
      code: i.code, kind: KIND_OF[i.code], earning: i.kind === 'earning', name: i.name, amount: toRupees(i.amount), working: i.working,
    })),
    notes,
    leaveBalances: (balances || []).map((b) => ({
      type: b.leave_type,
      available: Math.max(0, Number(b.total_allocated || 0) - Number(b.used || 0) - Number(b.encashed || 0)),
    })),
    rulesUsed: companyRules.resolveCompanyCalc(ctx.calc).gratuity,
  };
};

/**
 * Add the settlement to the final payslip as one-time pay — replacing any
 * settlement added before for that month — and refresh its draft.
 */
const applyFullAndFinal = async ({
  companyId, employeeId, actor, inputs, ipAddress = null,
}) => {
  if (String(employeeId) === String(actor?.id)) throw new ForbiddenError('You cannot settle your own pay — an admin has to.');
  const preview = await previewFullAndFinal({ companyId, employeeId, inputs });
  const oneTime = require('./oneTimePay.service');
  await oneTime.cancelSource({
    companyId, employeeId, month: preview.month, year: preview.year, source: 'fnf', actor,
  });
  const created = [];
  for (const i of preview.items) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await oneTime.createItem({
      companyId,
      employeeId,
      actor,
      month: preview.month,
      year: preview.year,
      kind: i.kind,
      name: i.name,
      amount: i.amount,
      source: 'fnf',
      note: 'Full and final settlement',
      ipAddress,
      recalculate: false,
    }));
  }
  // One refresh of the final payslip's draft, with every item in.
  oneTime.recalculateDrafts(employeeId, companyId);
  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.fnf.apply',
    targetType: 'employee',
    targetId: employeeId,
    afterState: { month: preview.month, year: preview.year, items: preview.items.map((i) => ({ code: i.code, amount: i.amount })) },
    ipAddress,
  }).catch(() => {});
  return { ...preview, added: created };
};

/** Make (or refresh) the final payslip's draft, once the last working day is over. */
const generateFinalPayslip = async ({ companyId, employeeId, actor }) => {
  const payroll = require('./payroll.service');
  const { lastWorkingDay } = await loadLeaver(companyId, employeeId);
  const payOn = await settlementPayslipMonth(employeeId, Number(lastWorkingDay.slice(5, 7)), Number(lastWorkingDay.slice(0, 4)));
  const { month, year } = payOn;
  if (!payOn.settlement && !payroll.monthHasEnded(month, year) && !payroll.leaverFinalMonthReady(lastWorkingDay, month, year)) {
    throw new BadRequestError(`The final payslip can be made from the day after their last working day (${lastWorkingDay}).`);
  }
  const payrollMonth = await payroll.initializeMonth(month, year, actor?.id || null, companyId);
  return payroll.generateDraftPayslip(payrollMonth.id, employeeId, companyId, { payrollMonth });
};

module.exports = {
  KIND_OF, previewFullAndFinal, applyFullAndFinal, generateFinalPayslip,
};
