const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const {
  BadRequestError, NotFoundError, ForbiddenError, ConflictError,
} = require('../utils/errors');
const { uploadPayslip, getSignedUrl, STORAGE_BUCKETS } = require('./storage.service');
const attendanceService = require('./attendance.service');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');
const settingsService = require('./settings.service');
const notificationService = require('./notification.service');
const emailService = require('./email.service');
const { buildPayslipPdfBuffer } = require('./payslipPdf.service');
const { buildMeta } = require('../utils/helpers');

const WORKING_DAYS_PER_MONTH = 26;
const MONTH_STATUS = { PENDING: 'PENDING', COMPLETED: 'COMPLETED' };
const PAYSLIP_STATUS = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' };
const PAYSLIP_EMPLOYEE_SELECT = 'id, first_name, last_name, employee_code, email, company_id, address, designation, date_of_joining, bank_details, salary_details, gender';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Professional Tax by state. Modeled per-state explicitly rather than one
 * generic monthly-slab table, because the real statutory rules genuinely
 * differ in structure and forcing them into one shape produces silently
 * wrong deductions:
 *  - Tamil Nadu's published slab is assessed on HALF-YEARLY income, not
 *    monthly — applying it directly to monthly gross both misclassifies
 *    the bracket and deducts 6x too much every month.
 *  - Karnataka and Maharashtra both carry an extra amount in February so
 *    twelve monthly deductions reach the ₹2,500 statutory annual cap
 *    (₹200 × 11 + ₹300 = ₹2,500).
 *  - Maharashtra additionally exempts women earning up to ₹25,000/month
 *    entirely, in force since the April 2023 amendment — this is not a
 *    different slab, it overrides the general slab outright below that
 *    threshold regardless of which band the amount would otherwise fall in.
 * Covers the states offered in Settings → Payroll → PT State. Not
 * exhaustive — states not listed here (or an unresolved employee gender
 * where it matters) fall back to the flat configured payroll_professional_tax amount.
 *
 * @param {string} state
 * @param {number} gross monthly gross
 * @param {{ month?: number, gender?: string }} ctx month is 1-12 (calendar month being paid); gender is the employee's gender_type ('male'|'female'|'other')
 * @returns {number|null} the PT amount, or null when the state isn't modeled (caller falls back)
 */
const getProfessionalTaxForState = (state, gross, { month, gender } = {}) => {
  const normalizedState = String(state || '').trim();
  const isFeb = Number(month) === 2;

  switch (normalizedState) {
    case 'Karnataka':
      if (gross <= 24999) return 0;
      return isFeb ? 300 : 200;

    case 'Maharashtra':
      if (gender === 'female' && gross <= 25000) return 0;
      if (gross <= 7500) return 0;
      if (gross <= 10000) return 175;
      return isFeb ? 300 : 200;

    case 'Tamil Nadu': {
      // Convert monthly gross to its half-yearly equivalent to match the
      // published slab's real basis, then divide the half-yearly amount
      // back down to the equivalent monthly deduction.
      const halfYearlyGross = gross * 6;
      const halfYearlySlabs = [
        { upTo: 21000, amount: 0 },
        { upTo: 30000, amount: 135 },
        { upTo: 45000, amount: 315 },
        { upTo: 60000, amount: 690 },
        { upTo: 75000, amount: 1025 },
        { upTo: Infinity, amount: 1250 },
      ];
      const slab = halfYearlySlabs.find((s) => halfYearlyGross <= s.upTo) || halfYearlySlabs[halfYearlySlabs.length - 1];
      return round2(slab.amount / 6);
    }

    case 'Delhi':
      return 0; // No professional tax levied in Delhi

    case 'Telangana':
      if (gross <= 15000) return 0;
      if (gross <= 20000) return 150;
      return 200;

    default:
      return null;
  }
};

const flagOn = (v, def = true) => {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  return Boolean(v);
};

/**
 * One employee's payroll setup — which statutory deductions apply to them
 * and which of the company's extra deductions they are opted out of
 * (Employee → Payroll → Payroll setup). Read from salary_details.
 *
 * ESI follows its switch only once someone has actually set it
 * (esi_set = true): the Edit Employee form used to save
 * esi_applicable = false for everyone, so that old value is not a choice
 * anybody made and must not switch ESI off.
 */
const resolvePayrollSetup = (salary = {}) => {
  const sd = salary || {};
  const optouts = Array.isArray(sd.deduction_optouts) ? sd.deduction_optouts.map(String) : [];
  const pfPercent = sd.pf_percent ?? sd.pfPercent;
  return {
    pf: flagOn(sd.pf_applicable ?? sd.pfApplicable, true),
    esi: sd.esi_set === true ? flagOn(sd.esi_applicable ?? sd.esiApplicable, true) : true,
    pt: flagOn(sd.pt_applicable ?? sd.ptApplicable, true),
    tdsMode: (() => {
      const m = String(sd.tds_mode ?? sd.tdsMode ?? 'company').toLowerCase();
      if (m === 'exempt') return 'none';
      if (m === 'manual') return 'fixed';
      return ['company', 'fixed', 'none'].includes(m) ? m : 'company';
    })(),
    tdsFixed: round2(Number(sd.tds_fixed ?? sd.tdsFixed ?? sd.tds ?? 0) || 0),
    pfPercent: pfPercent != null && pfPercent !== '' && Number.isFinite(Number(pfPercent)) ? Number(pfPercent) : null,
    optouts,
  };
};

/** A custom payroll option's stable key — its id, or its name for options saved before ids. */
const optionKey = (opt) => String(opt?.id || String(opt?.name || '').trim().toLowerCase());

/**
 * Everything company-wide a payslip needs — loaded once and reused for every
 * employee in a run (and by the pay simulator).
 */
const loadPayrollContext = async (companyId) => {
  const { getPayrollRules } = require('../utils/payrollRules');
  const { getWorkWeek } = require('../utils/workWeek');
  const [
    workingDaysSetting, pfRate, tdsPercent, esiEmployeePercent, esiThreshold, ptFlatAmount,
    payrollConfigRaw, rules, workWeek, leaveMeta,
  ] = await Promise.all([
    settingsService.getNumber('payroll_working_days', WORKING_DAYS_PER_MONTH, companyId),
    settingsService.getNumber('payroll_pf_rate', 0.12, companyId),
    settingsService.getNumber('payroll_tds_percent', 8, companyId),
    settingsService.getNumber('payroll_esi_employee_percent', 0.75, companyId),
    settingsService.getNumber('payroll_esi_threshold', 21000, companyId),
    settingsService.getNumber('payroll_professional_tax', 200, companyId),
    settingsService.getSetting('payroll_config', null, companyId),
    getPayrollRules(companyId),
    getWorkWeek(companyId),
    settingsService.getSetting('leave_policy_meta', null, companyId),
  ]);
  const payrollConfig = payrollConfigRaw || {};
  const { data: components, error: compErr } = await supabaseAdmin
    .from('payroll_components')
    .select('*')
    .eq('is_active', true)
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });
  if (compErr) throw new BadRequestError(compErr.message);
  return {
    companyId,
    workingDaysSetting: Math.max(1, workingDaysSetting),
    pfRate: Math.max(0, pfRate),
    tdsPercent: Math.max(0, tdsPercent),
    esiEmployeePercent: Math.max(0, esiEmployeePercent),
    esiThreshold: Math.max(0, esiThreshold),
    ptFlatAmount: Math.max(0, ptFlatAmount),
    payrollConfig,
    pfWageCeiling: payrollConfig.pf_wage_ceiling != null && payrollConfig.pf_wage_ceiling !== ''
      ? Number(payrollConfig.pf_wage_ceiling) : null,
    companyTdsMode: String(payrollConfig.tds_mode || 'auto'),
    ptState: String(payrollConfig.pt_state ?? payrollConfig.ptState ?? '').trim(),
    rules,
    workWeek,
    // Settings → Leave Policy → "Auto-deduct casual leave for unplanned absence".
    leaveFirst: flagOn(leaveMeta?.auto_deduct ?? leaveMeta?.autoDeduct, false),
    components: components || [],
  };
};

/** Casual Leave this employee could still spend this year: allocated − used − encashed. */
const LEAVE_FIRST_TYPE = 'CL';
const availableLeaveDays = async (employeeId, year, companyId) => {
  const { data: row, error } = await supabaseAdmin
    .from('leave_balances')
    .select('total_allocated, used, encashed')
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('leave_type', LEAVE_FIRST_TYPE)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  let allocated = row ? Number(row.total_allocated || 0) : null;
  if (allocated == null) {
    const leaveService = require('./leave.service');
    const policy = await leaveService.getEffectiveLeavePolicy(year, companyId);
    const cl = (policy || []).find((p) => p?.code === LEAVE_FIRST_TYPE && p.active !== false);
    allocated = cl ? Number(cl.allocation || 0) : 0;
  }
  return Math.max(0, allocated - Number(row?.used || 0) - Number(row?.encashed || 0));
};

/**
 * Which absences casual leave covers: whole absent days first, then half
 * days, oldest first, while the balance lasts. Pure — nothing is spent here;
 * the leave is taken only when the payslip is published.
 */
const planLeaveCover = (summary, available) => {
  let left = Math.max(0, Number(available || 0));
  const absentDates = [];
  const halfDayDates = [];
  for (const d of summary?.absentDates || []) {
    if (left < 1) break;
    absentDates.push(d);
    left -= 1;
  }
  for (const d of summary?.halfDayDates || []) {
    if (left < 0.5) break;
    halfDayDates.push(d);
    left -= 0.5;
  }
  return { type: LEAVE_FIRST_TYPE, absentDates, halfDayDates, days: absentDates.length + halfDayDates.length * 0.5 };
};

/** Overtime hours that count this month, from the attendance records. */
const eligibleOvertimeHours = (records, otRule) => {
  let hours = 0;
  let days = 0;
  for (const r of records || []) {
    const final = !r.checkout_status || r.checkout_status === 'finalized';
    if (!final || r.is_auto_checkout || !r.check_out_time) continue;
    const ot = Number(r.overtime_hours || 0);
    if (ot <= 0 || ot * 60 < Number(otRule.minMinutes || 0)) continue;
    hours += ot;
    days += 1;
  }
  const cap = Number(otRule.monthlyCapHours || 0);
  const capped = cap > 0 ? Math.min(hours, cap) : hours;
  return { hours: round2(capped), uncappedHours: round2(hours), days };
};

/**
 * The payslip calculation itself — pure, so the pay simulator shows exactly
 * what payroll will produce.
 *
 *   Gross        Basic + HRA + DA + Special + Transport + Medical + custom allowances
 *   Day rate     Gross ÷ days, per the company's day-rate basis (working / calendar / fixed)
 *   Unpaid days  absences not covered by casual leave (if "use leave first" is on)
 *                + ½ × uncovered half days + late-arrival penalty + days before joining
 *   LOP          Day rate × unpaid days
 *   Overtime     eligible hours × (day rate ÷ shift hours) × multiplier, when paid
 *   PF           earned Basic (capped at the wage ceiling) × rate          — if PF applies
 *   ESI          earned gross × rate, when contract gross ≤ the threshold  — if ESI applies
 *   PT           state slab on earned gross (or the flat amount)           — if PT applies
 *   TDS          company % of earned gross, a fixed amount, or none
 *   Custom       company extra deductions the employee isn't opted out of
 *   Net          Gross + overtime − LOP − deductions, never below 0
 *
 * "Earned" = what is left after loss of pay: statutory deductions follow the
 * pay actually earned, not the contract figure.
 */
const computePayslip = (ctx, {
  employee, summary = {}, records = [], month, year, leaveAvailable = 0, published = false, previousConfig = null,
}) => {
  const { latePenaltyDays } = require('../utils/payrollRules');
  const { countWorkingDays } = require('../utils/workWeek');
  const payslipMonth = Number(month) || (moment.tz(TIMEZONE).month() + 1);
  const payslipYear = Number(year) || moment.tz(TIMEZONE).year();
  const { rules, payrollConfig } = ctx;
  const setup = resolvePayrollSetup(employee?.salary_details);
  const salary = employee?.salary_details || {};

  const basic = round2(Number(salary.basic || 0));
  const hra = round2(Number(salary.hra || 0));
  const da = round2(Number(salary.da || 0));
  const special = round2(Number(salary.special || 0));
  const transport = round2(Number(salary.transport || 0));
  const medical = round2(Number(salary.medical || 0));
  const empPfRate = setup.pfPercent != null ? Math.max(0, setup.pfPercent / 100) : ctx.pfRate;

  const earnings = [
    { name: 'Basic', amount: basic },
    { name: 'HRA', amount: hra },
  ];
  if (da > 0) earnings.push({ name: 'DA', amount: da });
  if (special > 0) earnings.push({ name: 'Special Allowance', amount: special });
  if (transport > 0) earnings.push({ name: 'Transport Allowance', amount: transport });
  if (medical > 0) earnings.push({ name: 'Medical Allowance', amount: medical });
  let gross = round2(earnings.reduce((sum, e) => sum + Number(e.amount || 0), 0));

  // Custom allowances join gross before the day rate; custom deductions wait
  // until the earned figures are known.
  const customOptions = Array.isArray(payrollConfig.custom_payroll_options) ? payrollConfig.custom_payroll_options : [];
  const customDeductionDefs = [];
  for (const opt of customOptions) {
    if (!opt || opt.active === false || !String(opt.name || '').trim()) continue;
    const kind = String(opt.kind || opt.type || 'deduction').toLowerCase();
    if (kind === 'allowance' || kind === 'earning') {
      const valueType = String(opt.value_type || opt.valueType || 'fixed').toLowerCase();
      const baseAmt = String(opt.base || 'basic').toLowerCase() === 'gross' ? gross : basic;
      const amount = valueType === 'percent' ? round2(baseAmt * (Number(opt.value || 0) / 100)) : round2(Number(opt.value || 0));
      if (amount > 0) {
        earnings.push({ name: String(opt.name).trim(), amount });
        gross = round2(gross + amount);
      }
    } else {
      customDeductionDefs.push(opt);
    }
  }
  const contractGross = gross;

  // ── Day rate ────────────────────────────────────────────────────────────
  const monthStart = moment.tz({ year: payslipYear, month: payslipMonth - 1, day: 1 }, TIMEZONE);
  const daysInMonth = monthStart.daysInMonth();
  const workingDaysInMonth = Number(summary.workingDays) > 0
    ? Number(summary.workingDays)
    : countWorkingDays(monthStart, monthStart.clone().endOf('month'), ctx.workWeek);
  let dayBase;
  if (rules.dayRateBasis === 'calendar') dayBase = daysInMonth;
  else if (rules.dayRateBasis === 'fixed') dayBase = ctx.workingDaysSetting;
  else dayBase = workingDaysInMonth;
  dayBase = Math.max(1, dayBase);
  const perDay = gross / dayBase;

  // ── Unpaid days ─────────────────────────────────────────────────────────
  const absent = Number(summary.absent || 0);
  const halfDay = Number(summary.halfDay || 0);
  const lateCount = Number(summary.late || 0);
  const latePenalty = latePenaltyDays(lateCount, rules.late);

  // Casual leave first: planned on drafts, frozen once published (the
  // covered days became approved leave at publish, so they are no longer
  // absences and nothing is planned twice).
  let leaveCover = { type: LEAVE_FIRST_TYPE, absentDates: [], halfDayDates: [], days: 0 };
  if (published) {
    const frozen = previousConfig?.leave_cover;
    if (frozen && frozen.applied) leaveCover = { ...frozen };
  } else if (ctx.leaveFirst && (absent > 0 || halfDay > 0)) {
    leaveCover = planLeaveCover(summary, leaveAvailable);
  }
  const coveredAbsent = published ? 0 : leaveCover.absentDates.length;
  const coveredHalf = published ? 0 : leaveCover.halfDayDates.length;

  // Days before joining are unpaid — every calendar day of them under the
  // calendar basis, otherwise the working days.
  let notJoined = Number(summary.notJoined || 0);
  if (rules.dayRateBasis === 'calendar' && summary.joinedOn) {
    const joined = moment.tz(summary.joinedOn, TIMEZONE);
    if (joined.isAfter(monthStart, 'day') && joined.isSameOrBefore(monthStart.clone().endOf('month'), 'day')) {
      notJoined = joined.diff(monthStart, 'days');
    }
  }

  const unpaidDays = round2(Math.min(
    dayBase,
    Math.max(0, absent - coveredAbsent) + 0.5 * Math.max(0, halfDay - coveredHalf) + latePenalty + notJoined,
  ));
  const lop_deduction = round2(Math.min(gross, perDay * unpaidDays));
  const earnedRatio = Math.max(0, 1 - unpaidDays / dayBase);
  const earnedBasic = round2(basic * earnedRatio);
  const earnedGross = round2(Math.max(0, gross - lop_deduction));

  // ── Overtime ────────────────────────────────────────────────────────────
  const otRule = rules.overtime;
  const shiftHours = Number(summary.expectedHours) > 0 ? Number(summary.expectedHours) : 9;
  const ot = otRule.mode === 'off' ? { hours: 0, uncappedHours: 0, days: 0 } : eligibleOvertimeHours(records, otRule);
  const hourlyRate = perDay / shiftHours;
  let overtime_pay = 0;
  let compOffDays = 0;
  if (otRule.mode === 'pay' && ot.hours > 0) {
    overtime_pay = round2(ot.hours * hourlyRate * otRule.multiplier);
    earnings.push({ name: 'Overtime', amount: overtime_pay });
  } else if (otRule.mode === 'comp_off' && ot.hours > 0) {
    compOffDays = Math.floor((ot.hours * 2) / otRule.compOffHours) / 2;
  }
  if (published && previousConfig?.overtime?.comp_off_credited != null) {
    compOffDays = Number(previousConfig.overtime.comp_off_days || 0);
  }
  gross = round2(gross + overtime_pay);
  const taxable = round2(earnedGross + overtime_pay);

  // ── Statutory deductions, on earned pay ──────────────────────────────────
  const pfBase = ctx.pfWageCeiling != null && ctx.pfWageCeiling > 0 ? Math.min(earnedBasic, ctx.pfWageCeiling) : earnedBasic;
  const pf_deduction = setup.pf ? round2(pfBase * empPfRate) : 0;

  const esiEligible = contractGross <= ctx.esiThreshold;
  const esi_deduction = setup.esi && esiEligible ? round2(taxable * (ctx.esiEmployeePercent / 100)) : 0;

  const ptByState = getProfessionalTaxForState(ctx.ptState, taxable, { month: payslipMonth, gender: employee?.gender });
  const ptAmount = ptByState != null ? ptByState : ctx.ptFlatAmount;
  const professional_tax = setup.pt && taxable > 0 ? round2(ptAmount) : 0;

  let tds_deduction = 0;
  if (setup.tdsMode === 'none') {
    tds_deduction = 0;
  } else if (setup.tdsMode === 'fixed') {
    tds_deduction = setup.tdsFixed;
  } else if (salary.tds != null && Number(salary.tds) > 0 && ctx.companyTdsMode === 'manual') {
    tds_deduction = round2(Number(salary.tds));
  } else if (ctx.tdsPercent > 0) {
    tds_deduction = round2(taxable * (ctx.tdsPercent / 100));
  }

  const deductions = [];
  if (lop_deduction > 0) deductions.push({ name: 'LOP', amount: lop_deduction });
  if (pf_deduction > 0) deductions.push({ name: 'PF', amount: pf_deduction });
  if (professional_tax > 0) deductions.push({ name: 'Professional Tax', amount: professional_tax });
  if (esi_deduction > 0) deductions.push({ name: 'ESI', amount: esi_deduction });
  if (tds_deduction > 0) deductions.push({ name: 'TDS', amount: tds_deduction });

  const optedOut = new Set(setup.optouts);
  const skippedOptions = [];
  for (const opt of customDeductionDefs) {
    const name = String(opt.name).trim();
    if (optedOut.has(optionKey(opt)) || optedOut.has(name.toLowerCase())) {
      skippedOptions.push(name);
      continue;
    }
    const valueType = String(opt.value_type || opt.valueType || 'fixed').toLowerCase();
    const baseAmt = String(opt.base || 'basic').toLowerCase() === 'gross' ? taxable : earnedBasic;
    const amount = valueType === 'percent' ? round2(baseAmt * (Number(opt.value || 0) / 100)) : round2(Number(opt.value || 0));
    if (amount > 0) deductions.push({ name, amount });
  }

  // Legacy payroll_components (Settings → Salary Structure), if configured.
  const vars = {
    basic_salary: basic, hra, da, special, gross_salary: gross, unpaid_leave_days: unpaidDays,
    working_days: dayBase, lop_deduction, pf_deduction, professional_tax, tds_deduction, esi_deduction,
  };
  const skipNames = new Set(['basic', 'hra', 'da', 'special', 'special allowance', 'lop', 'pf', 'professional tax', 'pt', 'tds', 'esi', 'esic', 'overtime']);
  for (const c of ctx.components || []) {
    const name = String(c.name || '').trim().toLowerCase();
    if (skipNames.has(name)) continue;
    if (customOptions.some((o) => String(o.name || '').trim().toLowerCase() === name)) continue;
    const amount = computeRule(vars, c);
    if (amount <= 0) continue;
    if (c.type === 'EARNING') {
      earnings.push({ name: c.name, amount });
      gross = round2(gross + amount);
      vars.gross_salary = gross;
    } else {
      deductions.push({ name: c.name, amount });
    }
    if (c.output_field) vars[String(c.output_field)] = amount;
  }

  const gross_final = round2(gross);
  const total_deductions = round2(deductions.reduce((sum, d) => sum + Number(d.amount || 0), 0));
  const net_pay = round2(Math.max(0, gross_final - total_deductions));

  const breakdown_json = {
    earnings,
    deductions,
    totals: { gross_salary: gross_final, total_deductions, net_pay },
    config: {
      working_days: dayBase,
      working_days_in_month: workingDaysInMonth,
      days_in_month: daysInMonth,
      day_rate_basis: rules.dayRateBasis,
      per_day_rate: round2(perDay),
      working_days_setting: ctx.workingDaysSetting,
      pf_rate: empPfRate,
      company_pf_rate: ctx.pfRate,
      professional_tax,
      pt_state: ctx.ptState || null,
      esi_deduction,
      esi_threshold: ctx.esiThreshold,
      esi_eligible: esiEligible,
      tds_percent: ctx.tdsPercent,
      unpaid_leave_days: unpaidDays,
      absent,
      half_day: halfDay,
      not_joined_days: notJoined,
      late_count: lateCount,
      late_penalty_days: latePenalty,
      late_rule: rules.late,
      leave_cover: leaveCover.days > 0 || leaveCover.applied
        ? { ...leaveCover, applied: Boolean(leaveCover.applied) }
        : null,
      overtime: {
        mode: otRule.mode,
        hours: ot.hours,
        uncapped_hours: ot.uncappedHours,
        days: ot.days,
        hourly_rate: round2(hourlyRate),
        multiplier: otRule.multiplier,
        pay: overtime_pay,
        comp_off_days: compOffDays,
        comp_off_credited: published ? (previousConfig?.overtime?.comp_off_credited ?? null) : null,
      },
      earned_basic: earnedBasic,
      earned_gross: earnedGross,
      contract_gross: contractGross,
      pf_applicable: setup.pf,
      esi_applicable: setup.esi,
      pt_applicable: setup.pt,
      tds_mode: setup.tdsMode,
      opted_out: skippedOptions,
    },
  };

  return {
    basic_salary: basic,
    hra,
    gross_salary: gross_final,
    unpaid_leave_days: unpaidDays,
    lop_deduction,
    pf_deduction,
    professional_tax,
    esi_deduction,
    // Columns the Payroll Summary report reads (they were never filled, so
    // its Overtime column was always ₹0).
    overtime_pay,
    tds: tds_deduction,
    total_deductions,
    net_salary: net_pay,
    breakdown_json,
  };
};

/**
 * A payslip for one employee and month. `summary`/`records` come from
 * attendanceService.getMonthlySummary. opts: { year, records, ctx (reuse a
 * loaded payroll context), published, previousConfig }.
 */
const calculateContractPayslip = async (employee, attendanceSummary, month = null, opts = {}) => {
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const companyId = getCompanyId(employee) || DEFAULT_COMPANY_ID;
  const year = Number(opts.year) || moment.tz(TIMEZONE).year();
  const ctx = opts.ctx || await loadPayrollContext(companyId);
  const summary = attendanceSummary || {};
  let leaveAvailable = 0;
  if (!opts.published && ctx.leaveFirst && (Number(summary.absent || 0) > 0 || Number(summary.halfDay || 0) > 0) && employee?.id) {
    leaveAvailable = await availableLeaveDays(employee.id, year, companyId);
  }
  return computePayslip(ctx, {
    employee,
    summary,
    records: opts.records || [],
    month,
    year,
    leaveAvailable,
    published: Boolean(opts.published),
    previousConfig: opts.previousConfig || null,
  });
};

/**
 * What one employee's monthly pay works out to under the current settings,
 * for a full month with no leave deducted — the same calculation a payslip
 * uses, so the profile's figures match what payroll will produce. (The
 * profile used to work this out in the browser with hard-coded numbers: a
 * ₹200 professional tax whenever PT was 0, and always 8% TDS.)
 */
const previewEmployeeSalary = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees').select(PAYSLIP_EMPLOYEE_SELECT).eq('id', employeeId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!employee) throw new NotFoundError('Employee not found');
  const calc = await calculateContractPayslip(employee, { absent: 0, halfDay: 0 });
  const totals = calc.breakdown_json?.totals || {};
  return {
    gross: calc.gross_salary,
    basic: calc.basic_salary,
    pf: calc.pf_deduction,
    deductions: calc.breakdown_json?.deductions || [],
    totalDeductions: totals.total_deductions ?? 0,
    net: calc.net_salary,
    earnings: calc.breakdown_json?.earnings || [],
  };
};

// ── Per-employee payroll setup (Employee → Payroll → Payroll setup) ───────

const PF_STATUTORY_BASIC = 15000;
const MAX_FIXED_TDS = 10000000;

const customDeductionOptions = (payrollConfig) => (Array.isArray(payrollConfig?.custom_payroll_options)
  ? payrollConfig.custom_payroll_options
  : []
).filter((o) => o && o.active !== false && String(o.name || '').trim()
  && !['allowance', 'earning'].includes(String(o.kind || o.type || 'deduction').toLowerCase()));

const tdsLabel = (mode, fixed) => {
  if (mode === 'none') return 'None';
  if (mode === 'fixed') return `Fixed ₹${Number(fixed || 0).toLocaleString('en-IN')}`;
  return 'Company rate';
};

/** Human-readable state of every switch, keyed for comparing before/after. */
const describeSetup = (setup, options) => {
  const rows = [
    { key: 'pf', label: 'PF', value: setup.pf ? 'Deducted' : 'Not deducted' },
    { key: 'esi', label: 'ESI', value: setup.esi ? 'Deducted' : 'Not deducted' },
    { key: 'pt', label: 'Professional Tax', value: setup.pt ? 'Deducted' : 'Not deducted' },
    { key: 'tds', label: 'TDS', value: tdsLabel(setup.tdsMode, setup.tdsFixed) },
  ];
  const optedOut = new Set(setup.optouts);
  for (const opt of options) {
    rows.push({
      key: `opt:${optionKey(opt)}`,
      label: String(opt.name).trim(),
      value: optedOut.has(optionKey(opt)) || optedOut.has(String(opt.name).trim().toLowerCase()) ? 'Not deducted' : 'Deducted',
    });
  }
  return rows;
};

/** Legal reminders shown next to a switch that is off — warnings, never blocks. */
const setupWarnings = (setup, { basic, contractGross, esiThreshold }) => {
  const w = [];
  if (!setup.pf && basic <= PF_STATUTORY_BASIC) {
    w.push({ key: 'pf', message: `PF is compulsory when Basic is ₹${PF_STATUTORY_BASIC.toLocaleString('en-IN')} or less (Basic here is ₹${Math.round(basic).toLocaleString('en-IN')}), if your company is registered with EPF.` });
  }
  if (!setup.esi && contractGross <= esiThreshold) {
    w.push({ key: 'esi', message: `ESI is compulsory when monthly gross is ₹${Math.round(esiThreshold).toLocaleString('en-IN')} or less (gross here is ₹${Math.round(contractGross).toLocaleString('en-IN')}), if your company is covered by ESIC.` });
  }
  if (!setup.pt) {
    w.push({ key: 'pt', message: 'Professional Tax is set by state law — switch it off only where the state exempts this employee.' });
  }
  if (setup.tdsMode === 'none') {
    w.push({ key: 'tds', message: 'No TDS will be deducted. Make sure the employee\'s tax declarations support this.' });
  }
  return w;
};

const loadEmployeeForPayroll = async (employeeId) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees').select(PAYSLIP_EMPLOYEE_SELECT).eq('id', employeeId).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!employee) throw new NotFoundError('Employee not found');
  return employee;
};

const getPayrollSetup = async (employeeId) => {
  const employee = await loadEmployeeForPayroll(employeeId);
  const { getCompanyId } = require('../utils/tenant');
  const ctx = await loadPayrollContext(getCompanyId(employee));
  const setup = resolvePayrollSetup(employee.salary_details);
  const preview = computePayslip(ctx, { employee, summary: {}, records: [] });
  const cfg = preview.breakdown_json.config;
  const options = customDeductionOptions(ctx.payrollConfig);
  const amountOf = (name) => preview.breakdown_json.deductions.find((d) => d.name === name)?.amount ?? null;
  const optedOut = new Set(setup.optouts);
  const sd = employee.salary_details || {};
  return {
    employeeId,
    pf: setup.pf,
    esi: setup.esi,
    esiChosen: sd.esi_set === true,
    pt: setup.pt,
    tdsMode: setup.tdsMode,
    tdsFixed: setup.tdsFixed,
    customDeductions: options.map((o) => ({
      key: optionKey(o),
      name: String(o.name).trim(),
      optedOut: optedOut.has(optionKey(o)) || optedOut.has(String(o.name).trim().toLowerCase()),
      amount: amountOf(String(o.name).trim()),
      valueType: String(o.value_type || o.valueType || 'fixed').toLowerCase(),
      value: Number(o.value || 0),
    })),
    facts: {
      basic: preview.basic_salary,
      gross: cfg.contract_gross,
      esiThreshold: ctx.esiThreshold,
      esiEligible: cfg.esi_eligible,
      pfStatutoryBasic: PF_STATUTORY_BASIC,
    },
    amounts: {
      pf: amountOf('PF'), esi: amountOf('ESI'), pt: amountOf('Professional Tax'), tds: amountOf('TDS'),
    },
    preview: { gross: preview.gross_salary, net: preview.net_salary, totalDeductions: preview.breakdown_json.totals.total_deductions },
    warnings: setupWarnings(setup, { basic: preview.basic_salary, contractGross: cfg.contract_gross, esiThreshold: ctx.esiThreshold }),
    updatedAt: sd.payroll_setup_updated_at || null,
  };
};

/**
 * Tell the company's admins that one employee's deductions changed, with old
 * and new, and audit it. Used by the Payroll setup card and by Edit Employee
 * (which still has the PF / PT / TDS controls). Returns the changes.
 */
const notifyPayrollSetupChange = async ({ employee, beforeSalary, afterSalary, actor, ipAddress = null, payrollConfig = null }) => {
  const { getCompanyId } = require('../utils/tenant');
  const companyId = getCompanyId(employee);
  const cfg = payrollConfig || (await settingsService.getSetting('payroll_config', null, companyId)) || {};
  const options = customDeductionOptions(cfg);
  const beforeRows = describeSetup(resolvePayrollSetup(beforeSalary), options);
  const afterRows = describeSetup(resolvePayrollSetup(afterSalary), options);
  const changeList = afterRows
    .map((r) => ({ label: r.label, from: beforeRows.find((b) => b.key === r.key)?.value, to: r.value }))
    .filter((r) => r.from !== r.to);
  if (!changeList.length) return [];

  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll_setup.update',
    targetType: 'employee',
    targetId: employee.id,
    beforeState: Object.fromEntries(changeList.map((c) => [c.label, c.from])),
    afterState: Object.fromEntries(changeList.map((c) => [c.label, c.to])),
    ipAddress,
  }).catch(() => {});

  const { runInBackground } = require('../utils/background');
  const { getAdminEmailRecipients } = require('./emailRecipients.service');
  const admins = await getAdminEmailRecipients(companyId).catch(() => []);
  const changedByName = `${actor?.first_name || ''} ${actor?.last_name || ''}`.trim() || 'HR';
  for (const admin of admins) {
    runInBackground('payroll setup change admin email', () => emailService.payrollSetupChangedAdminEmail(admin, employee, changeList, { changedByName }));
  }
  changeList.emailedAdmins = admins.length;
  return changeList;
};

/**
 * HR/Admin change one employee's payroll setup. Every change is audited and
 * emailed to the company's admins with the old and new setting. Their open
 * draft payslips are recalculated in the background.
 */
const updatePayrollSetup = async ({ employeeId, changes = {}, actor, ipAddress = null }) => {
  const employee = await loadEmployeeForPayroll(employeeId);
  const { getCompanyId } = require('../utils/tenant');
  const companyId = getCompanyId(employee);
  const ctx = await loadPayrollContext(companyId);
  const options = customDeductionOptions(ctx.payrollConfig);
  const before = resolvePayrollSetup(employee.salary_details);
  const next = { ...before, optouts: [...before.optouts] };

  const bool = (v, label) => {
    if (typeof v !== 'boolean') throw new BadRequestError(`${label} must be on or off`);
    return v;
  };
  if (changes.pf !== undefined) next.pf = bool(changes.pf, 'PF');
  if (changes.esi !== undefined) next.esi = bool(changes.esi, 'ESI');
  if (changes.pt !== undefined) next.pt = bool(changes.pt, 'Professional Tax');
  if (changes.tdsMode !== undefined) {
    if (!['company', 'fixed', 'none'].includes(changes.tdsMode)) throw new BadRequestError('TDS must be company rate, fixed or none');
    next.tdsMode = changes.tdsMode;
  }
  if (changes.tdsFixed !== undefined) {
    const n = Number(changes.tdsFixed);
    if (!Number.isFinite(n) || n < 0 || n > MAX_FIXED_TDS) throw new BadRequestError('Enter a fixed TDS amount between ₹0 and ₹1,00,00,000');
    next.tdsFixed = round2(n);
  }
  if (next.tdsMode === 'fixed' && !(next.tdsFixed > 0)) throw new BadRequestError('Enter the fixed monthly TDS amount');
  if (changes.optouts !== undefined) {
    if (!Array.isArray(changes.optouts)) throw new BadRequestError('optouts must be a list');
    const known = new Map(options.map((o) => [optionKey(o), o]));
    for (const k of changes.optouts) {
      if (!known.has(String(k))) throw new BadRequestError('Unknown deduction in opt-outs — reload and try again');
    }
    // Keep opt-outs for options that are switched off company-wide right now.
    const inactive = before.optouts.filter((k) => !known.has(k));
    next.optouts = [...new Set([...inactive, ...changes.optouts.map(String)])];
  }

  const beforeRows = describeSetup(before, options);
  const afterRows = describeSetup(next, options);
  const diff = afterRows
    .map((r) => ({ ...r, from: beforeRows.find((b) => b.key === r.key)?.value }))
    .filter((r) => r.from !== r.value);
  const esiNewlyChosen = changes.esi !== undefined && employee.salary_details?.esi_set !== true;
  if (!diff.length && !esiNewlyChosen) return { changes: [], setup: await getPayrollSetup(employeeId), notified: false };

  const nowIso = new Date().toISOString();
  const salaryDetails = {
    ...(employee.salary_details || {}),
    pf_applicable: next.pf,
    pt_applicable: next.pt,
    esi_applicable: next.esi,
    ...(changes.esi !== undefined ? { esi_set: true } : {}),
    tds_mode: next.tdsMode,
    tds_fixed: next.tdsFixed,
    deduction_optouts: next.optouts,
    payroll_setup_updated_at: nowIso,
    payroll_setup_updated_by: actor?.id || null,
  };
  const { error } = await supabaseAdmin.from('employees')
    .update({ salary_details: salaryDetails, updated_at: nowIso }).eq('id', employeeId);
  if (error) throw new BadRequestError(error.message);

  const changeList = await notifyPayrollSetupChange({
    employee, beforeSalary: employee.salary_details, afterSalary: salaryDetails, actor, ipAddress, payrollConfig: ctx.payrollConfig,
  });
  const emailedAdmins = changeList.emailedAdmins || 0;
  const { runInBackground } = require('../utils/background');
  // Their open payslips follow the new setup.
  runInBackground('payroll setup recalculation', () => recalculatePayslipsFromSettings({ employeeId, companyId, draftsOnly: true }));

  return { changes: [...changeList], setup: await getPayrollSetup(employeeId), notified: emailedAdmins > 0, emailedAdmins };
};

// ── Pay rules & weekly offs (Settings → Payroll) ────────────────────────────

/** Saves the company's pay rules. Comp-off overtime needs a Comp Off leave type, so it is switched on if needed. */
const savePayrollRules = async (companyId, rawRules, actor) => {
  const { normalizePayrollRules } = require('../utils/payrollRules');
  const rules = normalizePayrollRules(rawRules);
  const { error } = await settingsService.setSetting('payroll_rules', rules, actor?.id || null, companyId);
  if (error) throw new BadRequestError(error.message);
  let compOffEnabled = false;
  if (rules.overtime.mode === 'comp_off') {
    const policy = await settingsService.getSetting('leave_policy', null, companyId);
    if (Array.isArray(policy) && policy.length) {
      const idx = policy.findIndex((p) => p?.code === COMP_OFF_TYPE);
      if (idx === -1 || policy[idx].active === false) {
        const nextPolicy = idx === -1
          ? [...policy, { code: COMP_OFF_TYPE, name: 'Comp Off', allocation: 0, active: true }]
          : policy.map((p, i) => (i === idx ? { ...p, active: true } : p));
        await settingsService.setSetting('leave_policy', nextPolicy, actor?.id || null, companyId);
        compOffEnabled = true;
      }
    }
  }
  // "Use casual leave first" lives in the leave policy (Settings → Leave
  // Policy shows the same switch). Merged in, never replacing the rest of it.
  let leaveFirst;
  if (typeof rawRules?.leaveFirst === 'boolean') {
    const meta = (await settingsService.getSetting('leave_policy_meta', null, companyId)) || {};
    const next = { ...meta, auto_deduct: rawRules.leaveFirst };
    delete next.autoDeduct;
    const { error: metaErr } = await settingsService.setSetting('leave_policy_meta', next, actor?.id || null, companyId);
    if (metaErr) throw new BadRequestError(metaErr.message);
    leaveFirst = rawRules.leaveFirst;
  }
  return { rules, compOffEnabled, leaveFirst };
};

// ── Pay simulator ───────────────────────────────────────────────────────────

const SIM_LIMITS = { absent: 31, halfDays: 31, lates: 31, overtimeHours: 300, overtimeDays: 31, notJoined: 31 };
const simNum = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

/**
 * What a month's pay would be — for one real employee or a sample salary —
 * under the settings on screen, saved or not. Uses the same calculation as
 * real payslips; nothing is stored.
 */
const simulatePay = async (companyId, body = {}) => {
  const { normalizePayrollRules } = require('../utils/payrollRules');
  const { normalizeWorkWeek, countWorkingDays } = require('../utils/workWeek');
  const ctx = { ...(await loadPayrollContext(companyId)) };
  const o = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
  if (o.rules) ctx.rules = normalizePayrollRules(o.rules);
  if (o.workWeek) ctx.workWeek = normalizeWorkWeek(o.workWeek);
  if (typeof o.leaveFirst === 'boolean') ctx.leaveFirst = o.leaveFirst;
  const pctOverride = (v, max) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.min(max, Math.max(0, Number(v))));
  const pf = pctOverride(o.pfPercent, 100);
  if (pf !== undefined) ctx.pfRate = pf / 100;
  const tds = pctOverride(o.tdsPercent, 100);
  if (tds !== undefined) ctx.tdsPercent = tds;
  const esi = pctOverride(o.esiPercent, 100);
  if (esi !== undefined) ctx.esiEmployeePercent = esi;
  const esiThr = pctOverride(o.esiThreshold, 10000000);
  if (esiThr !== undefined) ctx.esiThreshold = esiThr;
  const pt = pctOverride(o.ptAmount, 100000);
  if (pt !== undefined) ctx.ptFlatAmount = pt;
  if (typeof o.ptState === 'string') ctx.ptState = o.ptState.trim();
  if (o.pfWageCeiling === null || o.pfWageCeiling === '') ctx.pfWageCeiling = null;
  else if (o.pfWageCeiling !== undefined) ctx.pfWageCeiling = pctOverride(o.pfWageCeiling, 10000000) ?? ctx.pfWageCeiling;
  const fixedDays = pctOverride(o.workingDaysSetting, 31);
  if (fixedDays) ctx.workingDaysSetting = Math.max(1, fixedDays);
  if (Array.isArray(o.customOptions)) {
    ctx.payrollConfig = {
      ...ctx.payrollConfig,
      custom_payroll_options: o.customOptions.slice(0, 50).map((c) => ({
        id: c.id, name: String(c.name || '').slice(0, 80), kind: c.kind, value_type: c.valueType || c.value_type,
        value: Number(c.value) || 0, base: c.base, active: c.active !== false,
      })),
    };
  }

  // Whose pay: a real employee (their salary and setup), or a sample salary.
  let employee;
  if (body.employeeId) {
    employee = await loadEmployeeForPayroll(body.employeeId);
  } else {
    const gross = simNum(body.gross ?? 30000, 10000000);
    const basic = round2(gross * 0.5);
    const hra = round2(basic * 0.4);
    employee = { id: null, gender: null, salary_details: { basic, hra, special: round2(gross - basic - hra) } };
  }

  const now = moment.tz(TIMEZONE);
  const month = Number(body.month) >= 1 && Number(body.month) <= 12 ? Number(body.month) : now.month() + 1;
  const year = Number(body.year) >= 2000 && Number(body.year) <= 2100 ? Number(body.year) : now.year();
  const sc = body.scenario && typeof body.scenario === 'object' ? body.scenario : {};
  const absent = simNum(sc.absent, SIM_LIMITS.absent);
  const halfDays = simNum(sc.halfDays, SIM_LIMITS.halfDays);
  const lates = simNum(sc.lates, SIM_LIMITS.lates);
  const otHours = simNum(sc.overtimeHours, SIM_LIMITS.overtimeHours);
  const otDays = Math.max(otHours > 0 ? 1 : 0, Math.round(simNum(sc.overtimeDays ?? Math.ceil(otHours / 2), SIM_LIMITS.overtimeDays)));
  const monthStart = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE);
  const workingDays = countWorkingDays(monthStart, monthStart.clone().endOf('month'), ctx.workWeek);
  const fakeDates = (n) => Array.from({ length: Math.floor(n) }, (_, i) => monthStart.clone().add(i, 'days').format('YYYY-MM-DD'));
  const summary = {
    workingDays,
    absent: Math.floor(absent),
    halfDay: Math.floor(halfDays),
    late: Math.floor(lates),
    notJoined: 0,
    absentDates: fakeDates(absent),
    halfDayDates: fakeDates(halfDays),
    expectedHours: 9,
  };
  const records = otDays > 0
    ? Array.from({ length: otDays }, () => ({ overtime_hours: round2(otHours / otDays), check_out_time: 'x', checkout_status: 'finalized' }))
    : [];
  const leaveAvailable = sc.leaveBalance != null ? simNum(sc.leaveBalance, 366) : 12;
  const result = computePayslip(ctx, { employee, summary, records, month, year, leaveAvailable });
  return { ...result, month, year, workingDays, sample: !body.employeeId };
};

const computeRule = (vars, component) => {
  if (component.is_fixed) return round2(component.fixed_amount || 0);

  const target = String(component.target_field || '');
  const op = String(component.operator || '');
  const operand = component.operand_field ? Number(vars[String(component.operand_field)] || 0) : Number(component.operand_value || 0);
  const base = Number(vars[target] || 0);

  if (op === '%') return round2(base * (operand / 100));
  if (op === '*') return round2(base * operand);
  if (op === '+') return round2(base + operand);
  if (op === '-') return round2(base - operand);
  if (op === '/') return operand === 0 ? 0 : round2(base / operand);

  return round2(base);
};

const fetchMonthReimbursements = async (employeeId, month, year) => {
  if (!employeeId || !month || !year) return [];
  const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).startOf('month').format('YYYY-MM-DD');
  const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const { data } = await supabaseAdmin
    .from('reimbursements')
    .select('id, reimbursement_type, amount, description, expense_date, status')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .gte('expense_date', start)
    .lte('expense_date', end);
  return (data || []).map((r) => ({
    name: r.description
      || String(r.reimbursement_type || 'Reimbursement').replace(/_/g, ' '),
    amount: round2(Number(r.amount || 0)),
  }));
};

const enrichPayslipBreakdown = async (employee, calc, month, year) => {
  const salary = employee?.salary_details || {};
  const bank = employee?.bank_details || {};
  const monthly = ['basic', 'hra', 'da', 'special', 'transport', 'medical']
    .reduce((s, k) => s + Number(salary[k] || 0), 0);
  const ctc = round2(Number(salary.ctc || salary.annual_ctc || salary.annualCtc || monthly * 12));
  const cfg = calc.breakdown_json?.config || {};
  const working = Number(cfg.working_days || 0);
  const lop = Number(calc.unpaid_leave_days || cfg.unpaid_leave_days || 0);
  const paidDays = round2(Math.max(0, working - lop));
  const reimbursements = await fetchMonthReimbursements(employee.id, month, year);
  const totalReimb = round2(reimbursements.reduce((s, r) => s + Number(r.amount || 0), 0));
  const account = bank.account_number || bank.accountNumber || bank.account || '';
  const netPay = Number(calc.breakdown_json?.totals?.net_pay ?? calc.net_salary ?? 0);

  calc.breakdown_json = {
    ...calc.breakdown_json,
    reimbursements,
    totals: {
      ...(calc.breakdown_json?.totals || {}),
      total_reimbursements: totalReimb,
      net_payable: round2(netPay + totalReimb),
    },
    meta: {
      employee_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
      designation: employee.designation || '',
      date_of_joining: employee.date_of_joining || '',
      pay_method: account ? 'Net Banking' : '—',
      account_number: account,
      ctc,
      paid_days: paidDays,
      lop_days: lop,
      working_days: working,
    },
  };
  return calc;
};

const mapPayslipRow = (row) => ({
  id: row.id,
  payroll_month_id: row.payroll_month_id,
  user_id: row.employee_id,
  employee_id: row.employee_id,
  month: row.month,
  year: row.year,
  basic_salary: row.basic_salary,
  hra: row.hra,
  gross_salary: row.gross_salary,
  unpaid_leave_days: row.unpaid_leave_days,
  lop_deduction: row.lop_deduction,
  pf_deduction: row.pf_deduction,
  pt_deduction: row.professional_tax ?? row.pt_deduction,
  net_pay: row.net_salary,
  net_salary: row.net_salary,
  status: row.payslip_status || PAYSLIP_STATUS.DRAFT,
  payslip_url: row.payslip_url,
  breakdown_json: row.breakdown_json,
  payment_status: row.payment_status,
  employee: row.employee,
  first_name: row.employee?.first_name,
  last_name: row.employee?.last_name,
  employee_code: row.employee?.employee_code,
});

const initializeMonth = async (month, year, createdBy, companyId = null) => {
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const cid = companyId || DEFAULT_COMPANY_ID;

  let q = supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .eq('company_id', cid);
  const { data: existing } = await q.maybeSingle();

  // Contract: treat initialize as idempotent
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('payroll_months')
    .insert({
      month,
      year,
      status: MONTH_STATUS.PENDING,
      created_by: createdBy,
      company_id: cid,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const getMonthStatus = async (month, year, companyId = null) => {
  const { DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const cid = companyId || DEFAULT_COMPANY_ID;
  const { data, error } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('month', month)
    .eq('year', year)
    .eq('company_id', cid)
    .maybeSingle();

  if (error) throw new BadRequestError(error.message);
  return data || null;
};

const generateDraftPayslip = async (payrollMonthId, userId, companyId = null, opts = {}) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .single();

  if (!payrollMonth) throw new NotFoundError('Payroll month not found');
  // A client-supplied payroll_month_id must belong to the caller's own
  // company — otherwise an HR/Admin who knows/guesses another tenant's
  // payroll_months UUID could attach their own employee's payslip to it.
  if (companyId && payrollMonth.company_id !== companyId) {
    throw new NotFoundError('Payroll month not found');
  }
  // Allow generating slips for newly added employees even after a month was auto-closed
  if (payrollMonth.status === MONTH_STATUS.COMPLETED) {
    await supabaseAdmin
      .from('payroll_months')
      .update({ status: MONTH_STATUS.PENDING })
      .eq('id', payrollMonthId);
    payrollMonth.status = MONTH_STATUS.PENDING;
  }

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', userId)
    .eq('is_active', true)
    .single();

  if (!employee) throw new NotFoundError('Employee not found');

  const { data: existing } = await supabaseAdmin
    .from('payroll')
    .select('id, payslip_status')
    .eq('employee_id', userId)
    .eq('month', payrollMonth.month)
    .eq('year', payrollMonth.year)
    .maybeSingle();

  // If a draft already exists, recalculate and update it (so changes in Settings/components apply).
  if (existing?.id) {
    const existingStatus = String(existing.payslip_status || '').toUpperCase();
    if (existingStatus === PAYSLIP_STATUS.PUBLISHED) {
      throw new ConflictError('Payslip already published for this employee and month');
    }

    const { summary, records } = await attendanceService.getMonthlySummary(userId, payrollMonth.month, payrollMonth.year);
    const calc = await enrichPayslipBreakdown(
      employee,
      await calculateContractPayslip(employee, summary, payrollMonth.month, { year: payrollMonth.year, records, ctx: opts.ctx }),
      payrollMonth.month,
      payrollMonth.year,
    );

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('payroll')
      .update({
        ...calc,
        payslip_status: PAYSLIP_STATUS.DRAFT,
        payment_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
      .single();
    if (updErr) throw new BadRequestError(updErr.message);
    return mapPayslipRow(updated);
  }

  const { summary, records } = await attendanceService.getMonthlySummary(userId, payrollMonth.month, payrollMonth.year);
  const calc = await enrichPayslipBreakdown(
    employee,
    await calculateContractPayslip(employee, summary, payrollMonth.month, { year: payrollMonth.year, records, ctx: opts.ctx }),
    payrollMonth.month,
    payrollMonth.year,
  );

  const { data: payslip, error } = await supabaseAdmin
    .from('payroll')
    .insert({
      employee_id: userId,
      payroll_month_id: payrollMonthId,
      company_id: payrollMonth.company_id,
      month: payrollMonth.month,
      year: payrollMonth.year,
      ...calc,
      payslip_status: PAYSLIP_STATUS.DRAFT,
      payment_status: 'pending',
    })
    .select('*, employee:employee_id(id, first_name, last_name, employee_code, email, company_id, address)')
    .single();

  if (error) throw new BadRequestError(error.message);
  return mapPayslipRow(payslip);
};

const generateAllDraftPayslips = async (payrollMonthId, companyId = null) => {
  // No caller in this codebase ever legitimately omits companyId for a
  // payroll operation — fail closed instead of silently generating payslips
  // for every active employee on the entire platform.
  if (!companyId) throw new BadRequestError('companyId is required to generate payslips');

  const tenantService = require('./tenant.service');
  const ids = await tenantService.getCompanyEmployeeIds(companyId);
  const employees = ids.map((id) => ({ id }));

  const results = [];
  const ctx = await loadPayrollContext(companyId);
  for (const emp of employees) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const payslip = await generateDraftPayslip(payrollMonthId, emp.id, companyId, { ctx });
      results.push({ user_id: emp.id, status: 'generated', payslip });
    } catch (err) {
      results.push({ user_id: emp.id, status: 'skipped', reason: err.message });
    }
  }
  return results;
};

const generatePayslipPdf = (employee, payslip, payrollMonth, companyId) =>
  buildPayslipPdfBuffer(employee, payslip, payrollMonth, { companyId });

const maybeCloseMonth = async (payrollMonthId) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .single();

  if (!payrollMonth) return;

  const { count: employeeCount } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('company_id', payrollMonth.company_id);

  const { count: publishedCount } = await supabaseAdmin
    .from('payroll')
    .select('id', { count: 'exact', head: true })
    .eq('payroll_month_id', payrollMonthId)
    .eq('payslip_status', PAYSLIP_STATUS.PUBLISHED);

  if (employeeCount && publishedCount >= employeeCount) {
    await supabaseAdmin
      .from('payroll_months')
      .update({ status: MONTH_STATUS.COMPLETED })
      .eq('id', payrollMonthId);
  }
};

/**
 * What publishing a payslip does beyond the payslip itself, applied once —
 * the draft→published update is atomic, so a second publish never gets here:
 *  - "Use casual leave first": the absences the draft covered become
 *    approved Casual Leave (one record per day, marked as payroll's) and the
 *    leave balance is charged. From then on those days are leave, not
 *    absences, so recalculating the slip can't cover them twice.
 *  - Overtime as comp-off: the earned days are added to the employee's
 *    Comp Off balance for the year.
 * Returns the updated breakdown config (with applied flags) to store.
 */
const applyPublishEffects = async (payslip, publisher) => {
  const config = { ...(payslip.breakdown_json?.config || {}) };
  const monthLabel = moment.tz({ year: payslip.year, month: payslip.month - 1 }, TIMEZONE).format('MMMM YYYY');
  const nowIso = new Date().toISOString();
  const { getCompanyId } = require('../utils/tenant');
  const companyId = getCompanyId(payslip.employee) || publisher.company_id;

  const cover = config.leave_cover;
  if (cover && !cover.applied && Number(cover.days) > 0) {
    const rows = [
      ...(cover.absentDates || []).map((d) => ({ date: d, half: false })),
      ...(cover.halfDayDates || []).map((d) => ({ date: d, half: true })),
    ].map(({ date, half }) => ({
      employee_id: payslip.employee_id,
      company_id: companyId,
      leave_type: cover.type || LEAVE_FIRST_TYPE,
      from_date: date,
      to_date: date,
      total_days: half ? 0.5 : 1,
      is_half_day: half,
      reason: `Unplanned ${half ? 'half-day ' : ''}absence covered by casual leave (${monthLabel} payroll)`,
      status: 'approved',
      approved_by: publisher.id,
      approved_at: nowIso,
    }));
    try {
      const { error } = await supabaseAdmin.from('leaves').insert(rows);
      if (error) throw new Error(error.message);
      await require('./leave.service').adjustLeaveBalanceUsed(
        payslip.employee_id, `${payslip.year}-01-01`, cover.type || LEAVE_FIRST_TYPE, Number(cover.days),
      );
      config.leave_cover = { ...cover, applied: true, applied_at: nowIso };
    } catch (err) {
      logger.error('Payslip published but casual leave could not be recorded', { payslipId: payslip.id, error: err.message });
      config.leave_cover = { ...cover, applied: false, apply_error: err.message };
    }
  }

  const ot = config.overtime;
  if (ot && ot.mode === 'comp_off' && Number(ot.comp_off_days) > 0 && ot.comp_off_credited == null) {
    try {
      await creditCompOff(payslip.employee_id, payslip.year, Number(ot.comp_off_days), publisher);
      config.overtime = { ...ot, comp_off_credited: Number(ot.comp_off_days), comp_off_credited_at: nowIso };
    } catch (err) {
      logger.error('Payslip published but comp-off could not be credited', { payslipId: payslip.id, error: err.message });
      config.overtime = { ...ot, comp_off_error: err.message };
    }
  }
  return config;
};

const COMP_OFF_TYPE = 'COMP_OFF';
/** Adds earned comp-off days to the employee's Comp Off balance for the year. */
const creditCompOff = async (employeeId, year, days, actor) => {
  const { data: row, error } = await supabaseAdmin
    .from('leave_balances')
    .select('id, total_allocated')
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('leave_type', COMP_OFF_TYPE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // allocation_override keeps the credit: balances not set individually are
  // reset to the leave policy's allocation (0 for Comp Off) on every read.
  const patch = {
    allocation_override: true,
    allocation_updated_at: new Date().toISOString(),
    allocation_updated_by: actor?.id || null,
  };
  if (row) {
    const { error: e } = await supabaseAdmin.from('leave_balances')
      .update({ total_allocated: round2(Number(row.total_allocated || 0) + days), ...patch })
      .eq('id', row.id);
    if (e) throw new Error(e.message);
  } else {
    const { error: e } = await supabaseAdmin.from('leave_balances').insert({
      employee_id: employeeId, year, leave_type: COMP_OFF_TYPE, total_allocated: days, used: 0, encashed: 0, ...patch,
    });
    if (e) throw new Error(e.message);
  }
};

const publishPayslip = async (payslipId, publisher) => {
  const { data: payslip } = await supabaseAdmin
    .from('payroll')
    .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
    .eq('id', payslipId)
    .single();

  if (!payslip) throw new NotFoundError('Payslip not found');
  if (require('../utils/tenant').getCompanyId(payslip.employee) !== publisher.company_id) {
    throw new NotFoundError('Payslip not found');
  }
  if (payslip.payslip_status === PAYSLIP_STATUS.PUBLISHED) {
    throw new BadRequestError('Payslip is already published');
  }

  // Item 2: bank_details is optional at employee creation, so a draft
  // payslip can exist and be reviewed with it still missing — but
  // publishing is the point this payslip becomes final/actionable for
  // real disbursement, so it's the right gate to fail loudly here rather
  // than silently publishing a payslip with a blank account number.
  const bank = payslip.employee?.bank_details || {};
  const hasBankDetails = Boolean(
    (bank.account_number || bank.accountNumber || bank.account)
    && (bank.ifsc || bank.ifscCode)
    && (bank.bank_name || bank.bankName),
  );
  if (!hasBankDetails) {
    const name = `${payslip.employee?.first_name || ''} ${payslip.employee?.last_name || ''}`.trim() || 'this employee';
    throw new BadRequestError(`Cannot publish payslip for ${name} — bank details are missing. Ask them to add bank details, or add them via Employee → Edit.`);
  }

  // Prefer explicit link; fall back to month/year so older/seeded slips still publish
  let payrollMonth = null;
  if (payslip.payroll_month_id) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('id', payslip.payroll_month_id)
      .maybeSingle();
    payrollMonth = data;
  }
  if (!payrollMonth) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('month', payslip.month)
      .eq('year', payslip.year)
      .eq('company_id', publisher.company_id)
      .maybeSingle();
    payrollMonth = data;
  }
  // Auto-create the month row if still missing (test/seed gaps)
  if (!payrollMonth) {
    const { data, error: monthErr } = await supabaseAdmin
      .from('payroll_months')
      .insert({
        month: payslip.month,
        year: payslip.year,
        status: MONTH_STATUS.PENDING,
        created_by: publisher.id,
        company_id: publisher.company_id,
      })
      .select('*')
      .single();
    if (monthErr) throw new BadRequestError(monthErr.message);
    payrollMonth = data;
  }
  // Relink payslip so future publishes/downloads work
  if (payslip.payroll_month_id !== payrollMonth.id) {
    await supabaseAdmin
      .from('payroll')
      .update({ payroll_month_id: payrollMonth.id })
      .eq('id', payslipId);
    payslip.payroll_month_id = payrollMonth.id;
  }

  // The draft planned to cover some absences with casual leave. If the
  // balance has dropped since (leave taken in between), the draft's numbers
  // are out of date — regenerate it rather than publish pay the balance
  // can't back.
  const plannedCover = payslip.breakdown_json?.config?.leave_cover;
  if (plannedCover && !plannedCover.applied && Number(plannedCover.days) > 0) {
    const { getCompanyId } = require('../utils/tenant');
    const available = await availableLeaveDays(payslip.employee_id, payslip.year, getCompanyId(payslip.employee) || publisher.company_id);
    if (available < Number(plannedCover.days)) {
      throw new ConflictError(`This draft covers ${plannedCover.days} day(s) of absence with casual leave, but only ${available} day(s) are left now. Regenerate the draft, then publish.`);
    }
  }

  const pdfBuffer = await generatePayslipPdf(payslip.employee, payslip, payrollMonth, publisher.company_id);
  const { path } = await uploadPayslip(pdfBuffer, payslip.employee_id, payslip.month, payslip.year);
  // Audit finding N-09: was a 1-year TTL — this URL is a bearer credential
  // for a salary PDF with no further auth check once issued, and it's
  // returned as-is in the payroll list/detail API response (payslip_url).
  // The actual "download payslip" flow (downloadPayslip below) never uses
  // this stored URL at all — it regenerates the PDF fresh from live data
  // on every request — so this stored copy is only ever a background-
  // refreshed deep-link value, not something that needs a long lifetime.
  const signedUrl = await getSignedUrl(STORAGE_BUCKETS.payslips, path, 60 * 60);

  // published_by/published_at are the authoritative, queryable audit record
  // for who published this payslip — set from the authenticated `publisher`,
  // never from a request body. logger.info below stays as a secondary trace.
  const publishPatch = {
    payslip_status: PAYSLIP_STATUS.PUBLISHED,
    payslip_url: signedUrl,
    payment_status: 'processed',
    published_by: publisher.id,
    published_at: new Date().toISOString(),
  };

  // Audit finding N-06: .eq('payslip_status', DRAFT) on the write itself
  // closes the TOCTOU window between the read-time check above (line 705)
  // and this write — a lost race updates zero rows instead of double-
  // publishing (duplicate notification, duplicate month-close check).
  let { data: updated, error } = await supabaseAdmin
    .from('payroll')
    .update(publishPatch)
    .eq('id', payslipId)
    .eq('payslip_status', PAYSLIP_STATUS.DRAFT)
    .select('*, employee:employee_id(id, first_name, last_name, employee_code)')
    .maybeSingle();

  if (error && /column .*published_(by|at).* does not exist/i.test(error.message || '')) {
    // Migration 20260829_payroll_publish_audit.sql not applied yet in this
    // environment — fall back rather than blocking every publish on it.
    const { published_by, published_at, ...withoutAuditCols } = publishPatch;
    ({ data: updated, error } = await supabaseAdmin
      .from('payroll')
      .update(withoutAuditCols)
      .eq('id', payslipId)
      .eq('payslip_status', PAYSLIP_STATUS.DRAFT)
      .select('*, employee:employee_id(id, first_name, last_name, employee_code)')
      .maybeSingle());
  }

  if (error) throw new BadRequestError(error.message);
  if (!updated) throw new ConflictError('Payslip is already published');

  const appliedConfig = await applyPublishEffects(payslip, publisher);
  if (appliedConfig !== payslip.breakdown_json?.config) {
    const { error: cfgErr } = await supabaseAdmin
      .from('payroll')
      .update({ breakdown_json: { ...(payslip.breakdown_json || {}), config: appliedConfig } })
      .eq('id', payslipId);
    if (cfgErr) logger.error('Could not record what publishing applied', { payslipId, error: cfgErr.message });
  }

  await maybeCloseMonth(payslip.payroll_month_id);
  logger.info('Payslip published', { payslipId, publisherId: publisher.id });

  // Notify employee
  await notificationService.createNotification({
    user_id: payslip.employee_id,
    type: 'PAYROLL',
    title: 'Payslip published',
    message: `Your payslip for ${moment.tz({ year: payslip.year, month: payslip.month - 1 }, TIMEZONE).format('MMMM YYYY')} is now available.`,
    link: '/payroll/me',
    meta: { payslip_id: payslipId, month: payslip.month, year: payslip.year },
  });

  if (payslip.employee?.email) {
    // Section G1: the shared suppression gate — payslip email is a
    // Payroll-linked email, so it's absolutely blocked while Payroll
    // visibility is off for this company, independent of data_collection_mode.
    // The payslip record itself is still published/calculated normally either way.
    require('./emailSuppression.service').guardedSend(publisher.company_id, 'payroll', 'payslip_published', () =>
      emailService.payslipEmail(payslip.employee, payslip)).catch((e) =>
      logger.warn('payslipEmail failed', { error: e.message }));
  }

  require('./webhook.service').dispatchWebhookEvent(publisher.company_id, 'payroll.payslip_published', {
    payslipId: updated.id, employeeId: payslip.employee_id, month: payslip.month, year: payslip.year,
  });

  return {
    id: updated.id,
    status: PAYSLIP_STATUS.PUBLISHED,
    payslip_url: updated.payslip_url,
    ...mapPayslipRow(updated),
  };
};

const PAYROLL_LIST_SELECT = '*, employee:employee_id(id, first_name, last_name, employee_code, email, company_id, address)';

const listPayslips = async ({
  month, year, user, role, mine = false, companyId = null, pageQuery = {},
}) => {
  // Personal "My Payslips" (or employee role): only own published slips —
  // inherently bounded (one row per month, per employee), no pagination needed.
  const personalOnly = mine || role === 'employee' || role === 'manager';
  if (personalOnly) {
    const { data, error } = await supabaseAdmin
      .from('payroll')
      .select(PAYROLL_LIST_SELECT)
      .eq('month', month)
      .eq('year', year)
      .eq('employee_id', user.id)
      .eq('payslip_status', PAYSLIP_STATUS.PUBLISHED)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestError(error.message);
    return { data: (data || []).map(mapPayslipRow), meta: null };
  }

  // hr / admin without mine=true: company-wide list (Run Payroll / Salary
  // Sheet) — this is the branch that scales with headcount (audit M-14).
  let query = supabaseAdmin
    .from('payroll')
    .select(PAYROLL_LIST_SELECT, { count: 'exact' })
    .eq('month', month)
    .eq('year', year);

  if (companyId) {
    const tenantService = require('./tenant.service');
    const ids = await tenantService.getCompanyEmployeeIds(companyId);
    query = query.in(
      'employee_id',
      ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
    );
  }

  const page = Math.max(1, parseInt(pageQuery.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(pageQuery.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new BadRequestError(error.message);
  return { data: (data || []).map(mapPayslipRow), meta: buildMeta(page, limit, count || 0) };
};

/**
 * Re-apply live payroll settings to existing slips (draft + published).
 * Default: current calendar month + any PENDING payroll months.
 * Published slips keep PUBLISHED status; PDF is regenerated when present.
 */
const recalculatePayslipsFromSettings = async ({
  month, year, employeeId, companyId, draftsOnly = false,
} = {}) => {
  const now = moment.tz(TIMEZONE);
  const focusMonth = Number(month) || now.month() + 1;
  const focusYear = Number(year) || now.year();

  const targets = new Map();
  targets.set(`${focusYear}-${focusMonth}`, { month: focusMonth, year: focusYear });

  let pendingQuery = supabaseAdmin
    .from('payroll_months')
    .select('id, month, year, status, company_id')
    .eq('status', MONTH_STATUS.PENDING);
  if (companyId) pendingQuery = pendingQuery.eq('company_id', companyId);
  const { data: pendingMonths } = await pendingQuery;

  for (const pm of pendingMonths || []) {
    targets.set(`${pm.year}-${pm.month}`, { month: pm.month, year: pm.year, id: pm.id });
  }

  let updated = 0;
  const details = [];
  let companyEmployeeIds = null;
  if (companyId) {
    companyEmployeeIds = await require('./tenant.service').getCompanyEmployeeIds(companyId);
  }

  for (const t of targets.values()) {
    let query = supabaseAdmin
      .from('payroll')
      .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
      .eq('month', t.month)
      .eq('year', t.year);
    if (draftsOnly) query = query.neq('payslip_status', PAYSLIP_STATUS.PUBLISHED);
    if (employeeId) query = query.eq('employee_id', employeeId);
    else if (companyEmployeeIds) {
      query = query.in(
        'employee_id',
        companyEmployeeIds.length
          ? companyEmployeeIds
          : ['00000000-0000-0000-0000-000000000000']
      );
    }

    const { data: slips, error } = await query;

    if (error) throw new BadRequestError(error.message);

    const ctxByCompany = new Map();
    // Four at a time rather than one by one: each slip is ~10 database round
    // trips, and in series a company's open month took minutes.
    const { forEachWithLimit } = require('../utils/concurrency');
    await forEachWithLimit(slips || [], 4, async (row) => {
      try {
        const employee = row.employee;
        if (!employee) {
          details.push({ id: row.id, status: 'skipped', reason: 'Employee missing' });
          return;
        }

        const { summary, records } = await attendanceService.getMonthlySummary(
          row.employee_id,
          row.month,
          row.year
        );
        const wasPublished = String(row.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.PUBLISHED;
        const { getCompanyId: companyOf } = require('../utils/tenant');
        const cid = companyOf(employee);
        if (!ctxByCompany.has(cid)) ctxByCompany.set(cid, loadPayrollContext(cid));
        const calc = await enrichPayslipBreakdown(
          employee,
          await calculateContractPayslip(employee, summary, row.month, {
            year: row.year,
            records,
            ctx: await ctxByCompany.get(cid),
            // A published slip keeps what publishing did (leave taken,
            // comp-off credited) — only a draft plans them afresh.
            published: wasPublished,
            previousConfig: row.breakdown_json?.config || null,
          }),
          row.month,
          row.year,
        );

        const patch = {
          ...calc,
          updated_at: new Date().toISOString(),
        };

        // Numbers only here — downloadPayslip always rebuilds PDF from live row data.

        const { error: updErr } = await supabaseAdmin
          .from('payroll')
          .update(patch)
          .eq('id', row.id);

        if (updErr) throw new BadRequestError(updErr.message);

        updated += 1;
        details.push({
          id: row.id,
          employee_id: row.employee_id,
          month: row.month,
          year: row.year,
          status: wasPublished ? 'updated_published' : 'updated_draft',
          net_salary: calc.net_salary,
        });
      } catch (err) {
        details.push({ id: row.id, status: 'error', reason: err.message });
      }
    });
  }

  logger.info('Payslips recalculated from settings', { updated, focusMonth, focusYear });
  return { updated, month: focusMonth, year: focusYear, details };
};

/**
 * Same recalculation, run on the server in the background so a settings save
 * returns at once. One run per company at a time: saves made while one is
 * running collapse into a single follow-up run with the latest settings,
 * instead of piling up overlapping recalculations.
 */
const recalcRuns = new Map();
const queueRecalculationFromSettings = (opts = {}) => {
  const key = String(opts.companyId || 'all');
  const running = recalcRuns.get(key);
  if (running) {
    running.again = true;
    return { queued: true, alreadyRunning: true };
  }
  const run = { again: false };
  recalcRuns.set(key, run);
  (async () => {
    try {
      do {
        run.again = false;
        // eslint-disable-next-line no-await-in-loop
        await recalculatePayslipsFromSettings(opts);
      } while (run.again);
    } catch (err) {
      logger.error('Background payslip recalculation failed', { companyId: opts.companyId, error: err.message });
    } finally {
      recalcRuns.delete(key);
    }
  })();
  return { queued: true, alreadyRunning: false };
};

const downloadPayslip = async (payslipId, user) => {
  const { data: payslip } = await supabaseAdmin
    .from('payroll')
    .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
    .eq('id', payslipId)
    .single();

  if (!payslip) throw new NotFoundError('Payslip not found');

  const isOwn = payslip.employee_id === user.id;
  const isHrAdmin = ['hr', 'admin'].includes(user.role);
  if (require('../utils/tenant').getCompanyId(payslip.employee) !== user.company_id) {
    throw new NotFoundError('Payslip not found');
  }
  if (!isOwn && !isHrAdmin) throw new ForbiddenError('Not authorized');

  if (String(payslip.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.DRAFT) {
    throw new ForbiddenError('Payslip is not published yet');
  }

  let payrollMonth = null;
  if (payslip.payroll_month_id) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('id', payslip.payroll_month_id)
      .maybeSingle();
    payrollMonth = data;
  }
  if (!payrollMonth) {
    const { data } = await supabaseAdmin
      .from('payroll_months')
      .select('*')
      .eq('month', payslip.month)
      .eq('year', payslip.year)
      .maybeSingle();
    payrollMonth = data;
  }

  const pdfBuffer = await generatePayslipPdf(
    payslip.employee,
    payslip,
    payrollMonth || { month: payslip.month, year: payslip.year },
    user.company_id,
  );

  // Refresh stored copy in background so email/deep links stay current.
  // Audit finding N-09: shortened from a 1-year TTL — see the matching
  // comment in publishPayslip above.
  uploadPayslip(pdfBuffer, payslip.employee_id, payslip.month, payslip.year)
    .then(async ({ path }) => {
      const signedUrl = await getSignedUrl(STORAGE_BUCKETS.payslips, path, 60 * 60);
      await supabaseAdmin
        .from('payroll')
        .update({ payslip_url: signedUrl })
        .eq('id', payslipId);
    })
    .catch((err) => logger.warn('Payslip storage refresh failed', { payslipId, err: err.message }));

  const filename = `payslip-${payslip.year}-${String(payslip.month).padStart(2, '0')}.pdf`;
  return { buffer: pdfBuffer, filename, payslip: mapPayslipRow(payslip) };
};

/**
 * Auto-process for one company: initialize current month + generate draft payslips.
 * Idempotent per calendar month via payroll_config.last_auto_payroll_ym.
 */
const autoRunPayrollForCompany = async (companyId, { force = false } = {}) => {
  const settingsService = require('./settings.service');
  const tenantService = require('./tenant.service');

  const now = moment.tz(TIMEZONE);
  const month = now.month() + 1;
  const year = now.year();
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const payrollConfig = (await settingsService.getSetting('payroll_config', {}, companyId)) || {};
  const autoProcess = Boolean(
    payrollConfig.auto_process ?? payrollConfig.autoProcess ?? false,
  );
  if (!autoProcess && !force) {
    return { companyId, skipped: true, reason: 'auto_process_off' };
  }

  // Any day 1–31; in a shorter month (e.g. 30 in February) payroll runs on
  // that month's last day. It used to be capped at 28, so a saved 30 came
  // back as 28 and ran on the 28th.
  const runDate = Math.min(
    31,
    Math.max(1, Number(payrollConfig.run_date ?? payrollConfig.runDate ?? 25) || 25),
  );
  const runDay = Math.min(runDate, now.daysInMonth());
  if (!force && now.date() !== runDay) {
    return { companyId, skipped: true, reason: 'not_run_date', runDate, runDay, today: now.date() };
  }

  const lastYm = payrollConfig.last_auto_payroll_ym || payrollConfig.lastAutoPayrollYm;
  if (!force && lastYm === ym) {
    return { companyId, skipped: true, reason: 'already_ran', ym };
  }

  const adminIds = await tenantService.getCompanyHrAdminIds(companyId);
  const createdBy = adminIds[0] || null;

  const payrollMonth = await initializeMonth(month, year, createdBy, companyId);
  const results = await generateAllDraftPayslips(payrollMonth.id, companyId);
  const generated = results.filter((r) => r.status === 'generated').length;
  const skippedEmployees = results.filter((r) => r.status === 'skipped').length;

  await settingsService.setSetting(
    'payroll_config',
    {
      ...payrollConfig,
      auto_process: autoProcess || Boolean(payrollConfig.auto_process ?? payrollConfig.autoProcess),
      run_date: runDate,
      last_auto_payroll_ym: ym,
      last_auto_payroll_at: now.toISOString(),
    },
    createdBy,
    companyId,
  );

  return {
    companyId,
    month,
    year,
    payrollMonthId: payrollMonth.id,
    generated,
    skippedEmployees,
    skipped: false,
  };
};

/** Scan all active companies and auto-run payroll when due. */
const processAutoPayroll = async (reason = 'cron') => {
  const tenantService = require('./tenant.service');
  const companies = await tenantService.listActiveCompanies();
  const summary = { reason, companies: companies.length, ran: 0, skipped: 0, errors: 0, details: [] };

  for (const company of companies) {
    try {
      // Section G2: data_collection_mode='stop' for payroll — a clean,
      // total skip, no calculation and nothing written, checked before
      // autoRunPayrollForCompany does any work at all. Distinct from
      // visibility (which only ever gates outward emails/display) — this
      // is the one place a company can be excluded from processing itself.
      const mode = await require('./featureOverride.service').getDataCollectionMode(company.id, 'payroll');
      if (mode === 'stop') {
        logger.info('[AutoPayroll] Skipped — data_collection_mode is stop', { companyId: company.id, name: company.name });
        summary.skipped += 1;
        summary.details.push({ companyId: company.id, name: company.name, skipped: true, reason: 'data_collection_stopped' });
        continue;
      }

      const result = await autoRunPayrollForCompany(company.id);
      summary.details.push({ name: company.name, ...result });
      if (result.skipped) summary.skipped += 1;
      else summary.ran += 1;
    } catch (err) {
      summary.errors += 1;
      summary.details.push({ companyId: company.id, name: company.name, error: err.message });
      logger.error('Auto payroll failed for company', {
        companyId: company.id,
        name: company.name,
        error: err.message,
      });
    }
  }

  return summary;
};

module.exports = {
  calculateContractPayslip,
  getPayrollSetup,
  updatePayrollSetup,
  notifyPayrollSetupChange,
  savePayrollRules,
  simulatePay,
  computePayslip,
  loadPayrollContext,
  resolvePayrollSetup,
  planLeaveCover,
  eligibleOvertimeHours,
  initializeMonth,
  getMonthStatus,
  generateDraftPayslip,
  generateAllDraftPayslips,
  publishPayslip,
  listPayslips,
  downloadPayslip,
  recalculatePayslipsFromSettings,
  queueRecalculationFromSettings,
  previewEmployeeSalary,
  mapPayslipRow,
  autoRunPayrollForCompany,
  processAutoPayroll,
};
