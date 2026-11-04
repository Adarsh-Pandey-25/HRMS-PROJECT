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
const { selectIn } = require('../utils/selectIn');

const WORKING_DAYS_PER_MONTH = 26;
const MONTH_STATUS = { PENDING: 'PENDING', COMPLETED: 'COMPLETED' };
const PAYSLIP_STATUS = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' };
const PAYSLIP_EMPLOYEE_SELECT = 'id, first_name, last_name, employee_code, email, company_id, address, designation, date_of_joining, bank_details, salary_details, gender';
// For working pay out (never sent back as-is): the old regime's age rule needs the date of birth.
const PAYROLL_EMPLOYEE_SELECT = `${PAYSLIP_EMPLOYEE_SELECT}, date_of_birth, is_active, employment_status, offboarded_at`;

/** One employee for working out pay, with their last working day once its column exists. */
const selectEmployeeForPayroll = async (employeeId) => {
  let { data, error } = await supabaseAdmin
    .from('employees').select(`${PAYROLL_EMPLOYEE_SELECT}, last_working_day`).eq('id', employeeId).maybeSingle();
  if (error && /last_working_day/.test(error.message || '')) {
    ({ data, error } = await supabaseAdmin
      .from('employees').select(PAYROLL_EMPLOYEE_SELECT).eq('id', employeeId).maybeSingle());
  }
  return { data, error };
};

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// The calculation itself (pure, in paise) and the statutory values it uses —
// see backend/src/payroll/. This file prepares the inputs, stores the result
// and runs the payroll month around it.
const payrollEngine = require('../payroll/engine');
const statutory = require('../payroll/statutory');
const tdsProjection = require('../payroll/tds');
// The company's own calculation values, laid over the law (Settings → Payroll → Calculation).
const companyRules = require('../payroll/companyRules');
const { taxYearOf } = require('../payroll/taxRules');
const {
  toPaise, toRupees, percentRate, mulDiv, roundRupees,
} = require('../payroll/money');

/**
 * The six salary fields HR types per employee, as engine components. Basic
 * and DA are Labour Code wages unless the company counts others too
 * (companyRules.companyWages); `pfWage` is the standard.
 */
const SALARY_PARTS = [
  { code: 'BASIC', name: 'Basic', field: 'basic', pfWage: true, alwaysShown: true },
  { code: 'HRA', name: 'HRA', field: 'hra', alwaysShown: true },
  { code: 'DA', name: 'DA', field: 'da', pfWage: true },
  { code: 'SPECIAL', name: 'Special Allowance', field: 'special' },
  { code: 'TRANSPORT', name: 'Transport Allowance', field: 'transport' },
  { code: 'MEDICAL', name: 'Medical Allowance', field: 'medical' },
];

/** 1.5 → { num: 15, den: 10 } — an exact fraction for the overtime multiplier. */
const multiplierRate = (m) => {
  const r = percentRate(Number(m).toFixed(4).replace(/\.?0+$/, ''));
  return { num: r.num, den: r.den / 100 };
};

const ymd = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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
  const vpf = Number(sd.vpf_percent ?? sd.vpfPercent);
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
    // The monthly TDS HR typed for this person. salary_details.tds is not
    // read: the Edit Employee form used to save its own 8% estimate there.
    tdsFixed: round2(Number(sd.tds_fixed ?? sd.tdsFixed ?? 0) || 0),
    // Voluntary PF on top of the 12%, as a % of PF wages (employee only).
    vpfPercent: Number.isFinite(vpf) && vpf > 0 ? Math.min(100, vpf) : 0,
    optouts,
    // Statutory profile: disability (ESI's higher wage limit) and EPS membership.
    isPwd: sd.is_pwd === true,
    epsEligible: sd.eps_eligible !== false,
    // The state the employee works in, for Professional Tax (null = the company's state).
    ptState: statutory.findState(sd.pt_state)?.name || null,
    statutoryIds: {
      pan: String(sd.statutory_ids?.pan || '').toUpperCase(),
      uan: String(sd.statutory_ids?.uan || ''),
      esicIp: String(sd.statutory_ids?.esic_ip || ''),
    },
    // Income-tax inputs per tax year ('2026-27': { regime, … }) — see payroll/tds.js.
    taxYears: sd.tax_profile?.years && typeof sd.tax_profile.years === 'object' ? sd.tax_profile.years : {},
  };
};

const PF_POLICIES = ['not_applicable', 'statutory_ceiling', 'full_wages'];
// projected: worked out from the income-tax slabs each month (backend/src/payroll/tds.js)
const TDS_POLICIES = ['fixed_per_employee', 'projected', 'none'];

/**
 * The company's own payroll choices, from Settings → Payroll — every company
 * decides how it works (owner, 2 Nov 2026). The statutory rates live in
 * backend/src/payroll/statutory.js; a company's own values for them
 * (owner, 3 Nov 2026) are in the payroll_calc setting (payroll/companyRules.js).
 *
 * Settings saved before these choices existed keep what they meant:
 *   PF   payroll_pf_rate saved as 0 → not applicable; otherwise the legal ceiling
 *   ESI  payroll_esi_employee_percent saved as 0 → not covered
 *   TDS  any earlier mode → a fixed amount per employee (the flat % is gone);
 *        working it out from the tax slabs is a choice the company makes
 *   PT   the state as before; the old flat amount is not used (it charged
 *        ₹200 even in states with no PT)
 */
const resolvePayrollPolicy = (payrollConfig = {}, legacy = {}) => {
  const cfg = payrollConfig || {};
  // Only a value someone actually saved as 0 meant "off" — an unsaved one is not 0.
  const savedZero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0;
  let pfPolicy = PF_POLICIES.includes(cfg.pf_policy) ? cfg.pf_policy : null;
  if (!pfPolicy) pfPolicy = savedZero(legacy.pfRate) ? 'not_applicable' : 'statutory_ceiling';
  let esiApplicable = typeof cfg.esi_applicable === 'boolean' ? cfg.esi_applicable : null;
  if (esiApplicable === null) esiApplicable = !savedZero(legacy.esiPercent);
  const tdsPolicy = TDS_POLICIES.includes(cfg.tds_policy) ? cfg.tds_policy : 'fixed_per_employee';
  const manual = cfg.pt_manual_amount;
  const ptManualAmount = manual === null || manual === undefined || manual === '' || !Number.isFinite(Number(manual)) || Number(manual) < 0
    ? null
    : toPaise(manual);
  const ptState = String(cfg.pt_state ?? cfg.ptState ?? '').trim();
  return {
    pfPolicy,
    esiApplicable,
    tdsPolicy,
    ptState,
    ptManualAmount,
    ptManualSlabs: normalizePtSlabs(cfg.pt_manual_slabs),
    // Slabs the company entered for other states its staff work in (no SpaxSync table): { state name: slabs }.
    ptOtherStates: normalizeOtherStatePt(cfg.pt_other_states),
    // Labour Welfare Fund as the company entered it per state: { state name: { employee, employer, months } }.
    lwfStates: normalizeLwfStates(cfg.lwf_states),
    // The earlier settings screen saved Karnataka whenever no state was
    // picked; a Karnataka saved before this screen marked a real choice
    // (pt_state_set) has to be confirmed.
    ptStateUnconfirmed: ptState === 'Karnataka' && cfg.pt_state_set !== true,
    choicesMade: {
      pf: PF_POLICIES.includes(cfg.pf_policy),
      esi: typeof cfg.esi_applicable === 'boolean',
      tds: TDS_POLICIES.includes(cfg.tds_policy),
      pt: cfg.pt_state_set === true,
    },
  };
};

/**
 * The PT slabs a company entered for a state SpaxSync has no table for
 * (Settings → Payroll): [{ from, amount, february_amount }] in rupees, "from
 * this monthly gross, this PT". Returned in the engine's slab form (paise,
 * upper bounds), or null when there are none or they don't make sense.
 */
const MAX_PT_SLABS = 12;
const normalizePtSlabs = (raw) => {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_PT_SLABS) return null;
  const rows = [];
  for (const r of raw) {
    const from = Number(r?.from);
    const amount = Number(r?.amount);
    const feb = r?.february_amount === null || r?.february_amount === undefined || r?.february_amount === '' ? null : Number(r.february_amount);
    if (![from, amount].every(Number.isFinite) || from < 0 || amount < 0 || amount > 2500) return null;
    if (feb !== null && (!Number.isFinite(feb) || feb < 0 || feb > 2500)) return null;
    rows.push({ from: toPaise(from), amount: toPaise(amount), february: feb === null ? null : toPaise(feb) });
  }
  rows.sort((a, b) => a.from - b.from);
  if (new Set(rows.map((r) => r.from)).size !== rows.length) return null;
  // Below the first "from" nothing is due.
  if (rows[0].from > 0) rows.unshift({ from: 0, amount: 0, february: null });
  return rows.map((r, i) => ({
    upTo: i + 1 < rows.length ? rows[i + 1].from - 1 : null,
    amount: r.amount,
    ...(r.february !== null ? { februaryAmount: r.february } : {}),
  }));
};
/** [{ state, slabs }] the company entered for states other than its own → { canonical state name: engine slabs }. */
const MAX_PT_OTHER_STATES = 36;
const normalizeOtherStatePt = (raw) => {
  const out = {};
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_PT_OTHER_STATES)) {
    const state = statutory.findState(entry?.state);
    const slabs = normalizePtSlabs(entry?.slabs);
    if (state && slabs) out[state.name] = slabs;
  }
  return out;
};
/**
 * Labour Welfare Fund per state, as the company entered it from its state's
 * notification (SpaxSync ships no LWF table: only verified values may be
 * seeded). [{ state, employee, employer, months: [6, 12] }] in rupees.
 */
const MAX_LWF_AMOUNT = 1000;
const normalizeLwfStates = (raw) => {
  const out = {};
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, MAX_PT_OTHER_STATES)) {
    const state = statutory.findState(entry?.state);
    const employee = Number(entry?.employee);
    const employer = Number(entry?.employer);
    const months = [...new Set((Array.isArray(entry?.months) ? entry.months : []).map(Number))]
      .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b);
    const ok = (v) => Number.isFinite(v) && v >= 0 && v <= MAX_LWF_AMOUNT;
    if (!state || !ok(employee) || !ok(employer) || !months.length || (employee === 0 && employer === 0)) continue;
    out[state.name] = { employee: toPaise(employee), employer: toPaise(employer), months };
  }
  return out;
};
const COMPANY_PT_RULE_ID = 'PT-COMPANY';
/** The company's own PT slabs as a statutory rule the engine applies monthly. */
const companyPtRule = (slabs) => ({
  id: COMPANY_PT_RULE_ID,
  basis: 'monthly',
  slabs,
  source: 'Entered by the company in Settings → Payroll',
  status: 'company',
});

/** A salary amount as stored: a number, or text such as "22,000" or "₹ 22000". null when it isn't an amount. */
const salaryAmount = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'string' ? Number(v.replace(/[,\s₹]/g, '')) : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return toPaise(n);
};

/** Whole months from this payslip month to the month of `date` (0 when it is this month or earlier). */
const monthsUntil = (month, year, date) => {
  const d = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  return Math.max(0, (Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7))) - (year * 12 + month));
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
    workingDaysSetting, legacyPfRate, legacyEsiPercent,
    payrollConfigRaw, rules, workWeek, leaveMeta, calcRaw,
  ] = await Promise.all([
    settingsService.getNumber('payroll_working_days', WORKING_DAYS_PER_MONTH, companyId),
    settingsService.getSetting('payroll_pf_rate', null, companyId),
    settingsService.getSetting('payroll_esi_employee_percent', null, companyId),
    settingsService.getSetting('payroll_config', null, companyId),
    getPayrollRules(companyId),
    getWorkWeek(companyId),
    settingsService.getSetting('leave_policy_meta', null, companyId),
    settingsService.getSetting('payroll_calc', null, companyId),
  ]);
  const payrollConfig = payrollConfigRaw || {};
  const { data: components, error: compErr } = await supabaseAdmin
    .from('payroll_components')
    .select('*')
    .eq('is_active', true)
    .eq('company_id', companyId)
    .order('display_order', { ascending: true });
  if (compErr) throw new BadRequestError(compErr.message);
  const policy = resolvePayrollPolicy(payrollConfig, {
    pfRate: legacyPfRate == null ? null : legacyPfRate,
    esiPercent: legacyEsiPercent == null ? null : legacyEsiPercent,
  });
  return {
    companyId,
    workingDaysSetting: Math.max(1, Math.min(31, Math.round(workingDaysSetting))),
    payrollConfig,
    ...policy,
    rules,
    // The company's own calculation values (null = the law).
    calc: companyRules.normalizeCompanyCalc(calcRaw),
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
  // Never a day the employee took as unpaid leave.
  const unpaidLeave = new Set(summary?.unpaidLeaveDates || []);
  for (const d of (summary?.absentDates || []).filter((x) => !unpaidLeave.has(x))) {
    if (left < 1) break;
    absentDates.push(d);
    left -= 1;
  }
  for (const d of (summary?.payHalfDayDates || summary?.halfDayDates || []).filter((x) => !unpaidLeave.has(x))) {
    if (left < 0.5) break;
    halfDayDates.push(d);
    left -= 0.5;
  }
  return { type: LEAVE_FIRST_TYPE, absentDates, halfDayDates, days: absentDates.length + halfDayDates.length * 0.5 };
};

/** Whether an attendance record's overtime counts for pay. */
const countsForOvertime = (r, otRule) => {
  const final = !r.checkout_status || r.checkout_status === 'finalized';
  if (!final || r.is_auto_checkout || !r.check_out_time) return false;
  // A WFH check-in still waiting for its approval doesn't count yet.
  if (r.location?.wfh_pending === true) return false;
  const ot = Number(r.overtime_hours || 0);
  return ot > 0 && ot * 60 >= Number(otRule.minMinutes || 0);
};

/** Overtime hours that count this month, from the attendance records. */
const eligibleOvertimeHours = (records, otRule) => {
  let hours = 0;
  let days = 0;
  for (const r of records || []) {
    if (!countsForOvertime(r, otRule)) continue;
    hours += Number(r.overtime_hours || 0);
    days += 1;
  }
  const cap = Number(otRule.monthlyCapHours || 0);
  const capped = cap > 0 ? Math.min(hours, cap) : hours;
  return { hours: round2(capped), uncappedHours: round2(hours), days };
};

/**
 * Overtime (hundredths of an hour) in each part of a month split by a
 * revision, by the day it was worked; the monthly cap comes off the last parts.
 */
const overtimeByPart = (records, otRule, parts) => {
  const hours = parts.map(() => 0);
  for (const r of records || []) {
    if (!countsForOvertime(r, otRule)) continue;
    const day = moment(r.check_in_time).tz(TIMEZONE).format('YYYY-MM-DD');
    const i = parts.findIndex((p) => day >= p.from && day <= p.to);
    hours[i >= 0 ? i : parts.length - 1] += Math.round(Number(r.overtime_hours || 0) * 100);
  }
  const cap = Math.round(Number(otRule.monthlyCapHours || 0) * 100);
  let over = cap > 0 ? hours.reduce((a, h) => a + h, 0) - cap : 0;
  for (let i = hours.length - 1; i >= 0 && over > 0; i -= 1) {
    const take = Math.min(hours[i], over);
    hours[i] -= take;
    over -= take;
  }
  return hours;
};

/** "2.5" or 2.5 (a percentage) → the exact fraction the engine uses. */
const rateOf = (percent) => percentRate(String(Number(Number(percent).toFixed(4))));

/**
 * The salary in force over [from, to] (a payslip month), as parts
 * [{ from, to, salary, incomplete }] with dates as 'YYYY-MM-DD'.
 *
 * Applied salary revisions are replayed in the order they were applied:
 * each sets the salary from its effective date onward, so a back-dated
 * correction applied later wins over an earlier raise it overlaps, and two
 * revisions on one date resolve the same way every time. Before the first
 * one, the salary is the first-applied revision's previous_salary; from the
 * last change on, it is today's salary_details (an Edit Employee change
 * counts as a correction). Everything else in salary_details (switches, tax
 * profile) is today's. A part whose rates come from a revision record
 * missing a salary figure is `incomplete` — payroll refuses it rather than
 * pay ₹0 for it. Neighbouring parts with the same rates are merged.
 */
const salarySegments = ({
  current = {}, revisions = null, from, to,
}) => {
  const applied = (Array.isArray(revisions) ? revisions : [])
    .filter((r) => r && r.status === 'applied' && /^\d{4}-\d{2}-\d{2}/.test(String(r.effective_date || '')))
    .map((r, i) => ({
      date: String(r.effective_date).slice(0, 10),
      previous: r.previous_salary || {},
      next: r.new_salary || {},
      appliedAt: String(r.applied_at || ''),
      i,
    }))
    .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.date.localeCompare(b.date) || a.i - b.i);
  if (!applied.length) return [{ from, to, salary: current }];
  const rates = (src) => Object.fromEntries(SALARY_PARTS.map((sp) => [sp.field, src?.[sp.field]]));
  let timeline = [{ from: '0000-01-01', rates: rates(applied[0].previous), source: { date: applied[0].date, which: 'previous' } }];
  for (const r of applied) {
    // A revision after the latest stretch replaced what was in force over it —
    // its previous_salary, Edit Employee changes included.
    const latest = timeline[timeline.length - 1];
    if (r.date > latest.from) Object.assign(latest, { rates: rates(r.previous), source: { date: r.date, which: 'previous' } });
    timeline = timeline.filter((t) => t.from < r.date);
    timeline.push({ from: r.date, rates: rates(r.next), source: { date: r.date, which: 'new' } });
  }
  timeline[timeline.length - 1] = { ...timeline[timeline.length - 1], rates: null }; // today's salary
  const known = (v) => v !== null && v !== undefined && salaryAmount(v) !== null;
  const parts = [];
  timeline.forEach((t, i) => {
    const until = i + 1 < timeline.length
      ? moment.tz(timeline[i + 1].from, TIMEZONE).subtract(1, 'day').format('YYYY-MM-DD')
      : '9999-12-31';
    const partFrom = t.from > from ? t.from : from;
    const partTo = until < to ? until : to;
    if (partFrom > partTo) return;
    const salary = t.rates ? { ...current, ...t.rates } : current;
    const missing = t.rates ? SALARY_PARTS.filter((sp) => !known(t.rates[sp.field])).map((sp) => sp.name) : [];
    const incomplete = missing.length > 0;
    const last = parts[parts.length - 1];
    if (last && !incomplete && !last.incomplete
      && SALARY_PARTS.every((sp) => salaryAmount(last.salary[sp.field]) === salaryAmount(salary[sp.field]))) {
      last.to = partTo;
      if (!t.rates) last.salary = current;
    } else {
      parts.push({
        from: partFrom, to: partTo, salary, incomplete, ...(incomplete ? { missing, source: t.source } : {}),
      });
    }
  });
  return parts;
};

/** The employee's applied salary revisions (all of them: a later back-dated one can reach any month). */
const loadAppliedRevisions = async (employeeId) => {
  if (!employeeId) return [];
  const { data, error } = await supabaseAdmin
    .from('salary_revisions')
    .select('effective_date, previous_salary, new_salary, status, applied_at')
    .eq('employee_id', employeeId)
    .eq('status', 'applied')
    .order('applied_at', { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

/** Calendar days of the month before joining or after the last working day. */
const calendarDaysNotEmployed = ({
  daysInMonth, monthStart, monthEnd, joinedOn, lastWorkingDay,
}) => {
  let days = 0;
  if (joinedOn) {
    const joined = moment.tz(joinedOn, TIMEZONE).startOf('day');
    if (joined.isAfter(monthStart, 'day')) days += joined.diff(monthStart.clone().startOf('day'), 'days');
  }
  if (lastWorkingDay) {
    const left = moment.tz(lastWorkingDay, TIMEZONE).startOf('day');
    if (left.isBefore(monthEnd, 'day')) days += monthEnd.clone().startOf('day').diff(left, 'days');
  }
  return Math.min(daysInMonth, Math.max(0, days));
};

/**
 * The share of the month paid, as an exact fraction of the day basis.
 * Unpaid half days (absences, half days, late penalty) come off the basis.
 * Days not employed — before joining, after the last working day — come off as:
 *  - working basis: the working days the attendance summary counted;
 *  - calendar or fixed basis: their exact share of the calendar month, so a
 *    fixed 30-day basis pays someone who joins on the 16th of a 31-day month
 *    exactly 16/31 of the month (not 30 − 15 days, and not rounded to half days).
 */
const paidShare = ({
  basis, basisDays, daysInMonth, unpaidHalf, summary, monthStart, monthEnd, joinedOn, lastWorkingDay,
}) => {
  if (basis === 'working') {
    const notEmployed = Math.max(0, Number(summary.notJoined || 0)) + Math.max(0, Number(summary.afterLeaving || 0));
    const unpaid = Math.min(2 * basisDays, unpaidHalf + 2 * notEmployed);
    return {
      paid: { num: 2 * basisDays - unpaid, den: 2 * basisDays },
      notEmployedDays: notEmployed,
      calendarNotEmployedDays: calendarDaysNotEmployed({
        daysInMonth, monthStart, monthEnd, joinedOn, lastWorkingDay,
      }),
    };
  }
  const calendarDays = calendarDaysNotEmployed({
    daysInMonth, monthStart, monthEnd, joinedOn, lastWorkingDay,
  });
  // (1 − notEmployed ÷ daysInMonth) − unpaidHalf ÷ (2 × basis), over one denominator
  const den = 2 * basisDays * daysInMonth;
  const num = den - 2 * basisDays * calendarDays - unpaidHalf * daysInMonth;
  return { paid: { num: Math.max(0, num), den }, notEmployedDays: calendarDays, calendarNotEmployedDays: calendarDays };
};

const TAX_WORKSHEET_AMOUNTS = [
  'salary_paid_before', 'outside_income', 'this_month', 'future_monthly', 'projected_salary', 'other_income',
  'standard_deduction', 'professional_tax', 'exemptions_and_deductions', 'taxable_income', 'slab_tax', 'rebate',
  'surcharge', 'cess', 'annual_tax', 'tds_before', 'remaining', 'tds_due', 'tds', 'shortfall',
  'one_time', 'one_time_tax', 'annual_tax_regular', 'tds_regular',
];
/** The tax worksheet (tds.js, paise) in rupees, as stored on the payslip. */
const taxWorksheetInRupees = (w) => {
  const out = { ...w };
  for (const k of TAX_WORKSHEET_AMOUNTS) out[k] = toRupees(w[k] || 0);
  return out;
};

/**
 * One payslip: the engine's inputs (backend/src/payroll/engine.js) from the
 * employee, the month's attendance and the company's settings, and the
 * engine's result in the shape the payroll table, payslip, PDF and reports
 * read. Pure, so the pay simulator shows exactly what payroll will produce.
 *
 *   Unpaid days  absences not covered by casual leave (if "use leave first"
 *                is on) + ½ × uncovered half days + the late-arrival penalty
 *                + days not employed (before joining, after leaving)
 *   Earnings     each salary part × paid days ÷ basis days, to the rupee;
 *                gross = their sum + overtime (no separate LOP line)
 *   Deductions   PF, VPF, PT, ESI, TDS and the company's own — on earned pay
 *   Employer     EPS, EPF, EDLI, admin, ESI — shown, not deducted
 *
 * breakdown_json.config.blockers lists what makes this slip wrong to save
 * (PT not set up, deductions above pay); generating a draft refuses it.
 */
const computePayslip = (ctx, {
  employee, summary = {}, records = [], month, year, leaveAvailable = 0, published = false, previousConfig = null, history = null,
  revisions = null, loans = null, oneTime = null,
}) => {
  const { latePenaltyDays } = require('../utils/payrollRules');
  const { countWorkingDays } = require('../utils/workWeek');
  const payslipMonth = Number(month) || (moment.tz(TIMEZONE).month() + 1);
  const payslipYear = Number(year) || moment.tz(TIMEZONE).year();
  const { rules, payrollConfig } = ctx;
  const setup = resolvePayrollSetup(employee?.salary_details);
  const salary = employee?.salary_details || {};

  const monthStart = moment.tz({ year: payslipYear, month: payslipMonth - 1, day: 1 }, TIMEZONE);
  const monthEnd = monthStart.clone().endOf('month');

  // ── Salary parts (monthly contract rates) and company allowances ─────────
  const customOptions = Array.isArray(payrollConfig.custom_payroll_options) ? payrollConfig.custom_payroll_options : [];
  // The company's calculation values with the standard filled in, and the
  // parts it counts as Labour Code wages (Basic + DA unless it chose others).
  const calc = companyRules.resolveCompanyCalc(ctx.calc);
  const wageRule = companyRules.companyWages(ctx.calc, {
    ...Object.fromEntries(SALARY_PARTS.map((p) => [p.code, p.name])),
    ...Object.fromEntries(customOptions.filter((o) => o && String(o.name || '').trim()).map((o) => [`ALLOW:${optionKey(o)}`, String(o.name).trim()])),
  });
  const wageCodes = new Set(wageRule.codes);
  // Settings → Payroll → Salary structure: a part switched off there (HRA, say) isn't shown at ₹0.
  const switchedOff = (field) => {
    const c = payrollConfig.components;
    return field !== 'basic' && Boolean(c && typeof c === 'object' && !Array.isArray(c) && c[field] === false);
  };
  /** The engine's components for one salary record: the six parts and the company's allowances. */
  const componentsFor = (src) => {
    const problems = [];
    const list = SALARY_PARTS.map((p) => {
      const amount = salaryAmount(src[p.field]);
      if (amount === null) problems.push(p.name);
      return {
        code: p.code,
        name: p.name,
        monthly: amount || 0,
        pfWage: wageCodes.has(p.code),
        alwaysShown: Boolean(p.alwaysShown) && !switchedOff(p.field),
      };
    });
    const basicMonthly = list[0].monthly;
    let gross = list.reduce((sum, c) => sum + c.monthly, 0);
    for (const opt of customOptions) {
      if (!opt || opt.active === false || !String(opt.name || '').trim()) continue;
      const kind = String(opt.kind || opt.type || 'deduction').toLowerCase();
      if (kind !== 'allowance' && kind !== 'earning') continue;
      const valueType = String(opt.value_type || opt.valueType || 'fixed').toLowerCase() === 'percent' ? 'percent' : 'fixed';
      const value = Number(opt.value || 0);
      if (!(value > 0)) continue;
      const base = String(opt.base || 'basic').toLowerCase() === 'gross' ? 'gross' : 'basic';
      // A % allowance is worked out on the contract Basic or gross so far, as before.
      const monthly = valueType === 'percent'
        ? mulDiv(base === 'gross' ? gross : basicMonthly, rateOf(value).num, rateOf(value).den)
        : toPaise(value);
      if (monthly <= 0) continue;
      list.push({ code: `ALLOW:${optionKey(opt)}`, name: String(opt.name).trim(), monthly, pfWage: wageCodes.has(`ALLOW:${optionKey(opt)}`) });
      gross += monthly;
    }
    return { components: list, runningGross: gross, problems };
  };
  // The salary in force during the month: revisions change salary_details on
  // their effective date and payroll runs after the month ends, so the
  // month's rates come from the revision history; a revision inside the
  // month splits it, each part at its own rates.
  const salaryParts = salarySegments({
    current: salary, revisions, from: monthStart.format('YYYY-MM-DD'), to: monthEnd.format('YYYY-MM-DD'),
  }).map((seg) => ({ ...seg, ...componentsFor(seg.salary) }));
  const latestPart = salaryParts[salaryParts.length - 1];
  const components = latestPart.components;
  const runningGross = latestPart.runningGross;
  const salaryProblems = [...new Set(salaryParts.flatMap((seg) => seg.problems))];
  const salaryHistoryGap = salaryParts.find((seg) => seg.incomplete);
  const customDeductions = [];
  for (const opt of customOptions) {
    if (!opt || opt.active === false || !String(opt.name || '').trim()) continue;
    const kind = String(opt.kind || opt.type || 'deduction').toLowerCase();
    if (kind === 'allowance' || kind === 'earning') continue;
    const valueType = String(opt.value_type || opt.valueType || 'fixed').toLowerCase() === 'percent' ? 'percent' : 'fixed';
    const value = Number(opt.value || 0);
    if (!(value > 0)) continue;
    const base = String(opt.base || 'basic').toLowerCase() === 'gross' ? 'gross' : 'basic';
    const name = String(opt.name).trim();
    customDeductions.push(valueType === 'percent'
      ? { key: optionKey(opt), name, valueType, rate: rateOf(value), base }
      : { key: optionKey(opt), name, valueType, amount: toPaise(value) });
  }

  // ── Days ────────────────────────────────────────────────────────────────
  const daysInMonth = monthStart.daysInMonth();
  const workingDaysInMonth = Number(summary.workingDays) > 0
    ? Number(summary.workingDays)
    : countWorkingDays(monthStart, monthEnd, ctx.workWeek);
  let dayBase;
  if (rules.dayRateBasis === 'calendar') dayBase = daysInMonth;
  else if (rules.dayRateBasis === 'fixed') dayBase = ctx.workingDaysSetting;
  else dayBase = workingDaysInMonth;
  dayBase = Math.max(1, Math.round(dayBase));

  const absent = Number(summary.absent || 0);
  // Half days and late arrivals on a day of approved paid leave cost nothing
  // more (attendance reports them separately for pay: payHalfDay, payLate).
  const halfDay = Number(summary.payHalfDay ?? summary.halfDay ?? 0);
  const lateCount = Number(summary.payLate ?? summary.late ?? 0);
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

  // From the month's attendance summary, so a preview (no summary) is always a full month.
  const joinedOn = summary.joinedOn || null;
  const lastWorkingDay = summary.leftOn || null;
  const unpaidHalf = Math.min(
    2 * dayBase,
    2 * Math.max(0, absent - coveredAbsent) + Math.max(0, halfDay - coveredHalf) + Math.round(2 * latePenalty),
  );
  const share = paidShare({
    basis: rules.dayRateBasis, basisDays: dayBase, daysInMonth, unpaidHalf, summary, monthStart, monthEnd, joinedOn, lastWorkingDay,
  });
  let { paid } = share;
  const { notEmployedDays, calendarNotEmployedDays } = share;
  // A mid-month revision: each part's share of the month, over one
  // denominator (2 × basis × days in month). Unpaid days count in the part
  // they fall in; the late-arrival penalty (no date) in the last part.
  let salarySplit = null;
  let splitFullShares = null;
  if (salaryParts.length > 1) {
    const den = 2 * dayBase * daysInMonth;
    const working = rules.dayRateBasis === 'working';
    const coveredAbsentDates = new Set(published ? [] : leaveCover.absentDates);
    const coveredHalfDates = new Set(published ? [] : leaveCover.halfDayDates);
    const unpaidDated = [
      ...(summary.absentDates || []).filter((d) => !coveredAbsentDates.has(d)).map((d) => ({ date: d, halves: 2 })),
      ...(summary.payHalfDayDates || summary.halfDayDates || []).filter((d) => !coveredHalfDates.has(d)).map((d) => ({ date: d, halves: 1 })),
    ];
    // A whole day in units of den: a calendar day, or a working day on the working basis.
    const unit = working ? 2 * daysInMonth : 2 * dayBase;
    const daysIn = (from, to) => (working
      ? countWorkingDays(moment.tz(from, TIMEZONE), moment.tz(to, TIMEZONE), ctx.workWeek)
      : moment.tz(to, TIMEZONE).diff(moment.tz(from, TIMEZONE), 'days') + 1);
    // Each part's share while employed, before unpaid days.
    const capacity = salaryParts.map((part) => {
      const from = joinedOn && joinedOn > part.from ? joinedOn : part.from;
      const to = lastWorkingDay && lastWorkingDay < part.to ? lastWorkingDay : part.to;
      return from <= to ? daysIn(from, to) * unit : 0;
    });
    // Unpaid days come off the part they fall in; what a part can't take comes
    // off the parts before it (nearest first), then after it. The late-arrival
    // penalty (no date) comes off the last part, then backwards. The parts then
    // add up to exactly the month's paid share.
    const used = capacity.map(() => 0);
    const takeFrom = (i, units) => {
      const t = Math.min(capacity[i] - used[i], units);
      used[i] += t;
      return units - t;
    };
    salaryParts.forEach((part, i) => {
      const halves = unpaidDated.filter((u) => u.date >= part.from && u.date <= part.to).reduce((a, u) => a + u.halves, 0);
      let left = takeFrom(i, halves * daysInMonth);
      for (let j = i - 1; j >= 0 && left > 0; j -= 1) left = takeFrom(j, left);
      for (let j = i + 1; j < salaryParts.length && left > 0; j += 1) left = takeFrom(j, left);
    });
    let late = Math.round(2 * latePenalty) * daysInMonth;
    for (let j = salaryParts.length - 1; j >= 0 && late > 0; j -= 1) late = takeFrom(j, late);
    const target = working ? share.paid.num * daysInMonth : share.paid.num;
    let excess = capacity.reduce((a, c, i) => a + c - used[i], 0) - target;
    for (let i = salaryParts.length - 1; i >= 0 && excess !== 0; i -= 1) {
      const change = excess > 0 ? Math.min(excess, capacity[i] - used[i]) : Math.max(excess, -used[i]);
      used[i] += change;
      excess -= change;
    }
    salarySplit = salaryParts.map((part, i) => ({
      from: part.from,
      to: part.to,
      paid: { num: capacity[i] - used[i], den },
      rates: Object.fromEntries(part.components.map((c) => [c.code, c.monthly])),
    }));
    paid = { num: salarySplit.reduce((a, part) => a + part.paid.num, 0), den };
    // The month at the split rates with nothing unpaid — what loss of pay is measured against.
    splitFullShares = salaryParts.map((part) => daysIn(part.from, part.to) * unit);
  }
  // ESI's ₹176-a-day rule counts the calendar days paid for (weekly offs included).
  const esiPaidDays = { num: Math.max(0, 2 * (daysInMonth - calendarNotEmployedDays) - unpaidHalf), den: 2 };

  // ── Overtime hours ──────────────────────────────────────────────────────
  const otRule = rules.overtime;
  const shiftHours = Number(summary.expectedHours) > 0 ? Number(summary.expectedHours) : 9;
  const ot = otRule.mode === 'off' ? { hours: 0, uncappedHours: 0, days: 0 } : eligibleOvertimeHours(records, otRule);
  let compOffDays = 0;
  if (otRule.mode === 'comp_off' && ot.hours > 0) {
    compOffDays = Math.floor((ot.hours * 2) / otRule.compOffHours) / 2;
  }
  if (published && previousConfig?.overtime?.comp_off_credited != null) {
    compOffDays = Number(previousConfig.overtime.comp_off_days || 0);
  }

  // ── The statutory rules in force on the month's last day ────────────────
  const onDate = monthEnd.format('YYYY-MM-DD');
  // The law in force, with the company's own values on top; what differs from
  // the law is recorded on the payslip and raises a warning.
  const epfCompany = companyRules.companyEpf(statutory.epfRule(onDate), ctx.calc);
  const esiCompany = companyRules.companyEsi(statutory.esiRule(onDate), ctx.calc);
  const epf = epfCompany.rule;
  const esi = esiCompany.rule;
  const companyValues = [...wageRule.changed, ...epfCompany.changed, ...esiCompany.changed];
  if (calc.tds.defaultRegime === 'old') {
    companyValues.push({ key: 'tds.defaultRegime', label: 'Tax regime for employees who haven\'t chosen', law: 'new', company: 'old' });
  }
  const otMinimum = statutory.overtimeRule(onDate);
  // PT follows the state the employee works in: their own (Payroll setup), else the company's.
  const ownPtState = Boolean(setup.ptState) && setup.ptState !== (statutory.findState(ctx.ptState)?.name || ctx.ptState);
  const ptStateName = ownPtState ? setup.ptState : ctx.ptState;
  const statePt = statutory.ptRule(ptStateName, onDate);
  // A state SpaxSync has no table for: the slabs the company entered for it, if any.
  const enteredSlabs = ownPtState ? (ctx.ptOtherStates || {})[setup.ptState] : ctx.ptManualSlabs;
  const pt = enteredSlabs && ['manual', 'verify', 'missing'].includes(statePt.kind)
    ? { ...statePt, kind: 'slab', rule: companyPtRule(enteredSlabs) }
    : statePt;
  // Labour Welfare Fund of the state the employee works in, in its deduction months.
  const lwfStateName = statutory.findState(ptStateName)?.name || null;
  const lwfRule = lwfStateName ? (ctx.lwfStates || {})[lwfStateName] || null : null;
  const lwfThisMonth = lwfRule && lwfRule.months.includes(payslipMonth) ? lwfRule : null;
  // Tamil Nadu-style half-yearly PT looks at the whole half-year: a preview
  // (no payslips) assumes this pay in its earlier months, and a leaver's
  // months stop at the last working day, so their last slip settles it.
  let ptHistory = history?.pt || null;
  const ptEarlierDrafts = pt.rule?.basis === 'half_yearly' && !published && setup.pt ? (history?.ptEarlierDrafts || []) : [];
  if (pt.rule?.basis === 'half_yearly') {
    const calendarLeft = ptHistory?.monthsLeft ?? monthsLeftInHalfYear(payslipMonth);
    if (!ptHistory) ptHistory = payrollEngine.steadyHalfYearPtHistory(pt.rule, runningGross, calendarLeft);
    const leaving = lastWorkingDay || lastWorkingDayOf(employee);
    const untilLeaving = leaving ? monthsUntil(payslipMonth, payslipYear, leaving) + 1 : calendarLeft;
    ptHistory = { ...ptHistory, monthsLeft: Math.max(1, Math.min(calendarLeft, untilLeaving)) };
  }

  // One-time pay this month (arrears, bonus, …) goes into the calculation; one-time
  // recoveries (notice not served, …) come off at the end, like loans.
  const oneTimeItems = Array.isArray(oneTime) ? oneTime.filter((i) => i && Number(i.amount) > 0) : [];
  const oneTimeEarnings = oneTimeItems.filter((i) => i.earning).map((i) => ({
    code: `ONE_TIME:${i.id}`, name: i.name, amount: Math.round(Number(i.amount)), pfWage: Boolean(i.pfWage), esiWage: Boolean(i.esiWage), taxable: i.taxable !== false,
  }));
  const oneTimeRecoveryItems = oneTimeItems.filter((i) => !i.earning);
  const engineInput = {
    period: { year: payslipYear, month: payslipMonth },
    employee: {
      gender: employee?.gender || null,
      isPwd: salary.is_pwd === true,
      epsEligible: salary.eps_eligible !== false,
    },
    components,
    days: {
      basisDays: dayBase, paid, esiPaidDays, segments: salarySplit,
    },
    overtime: {
      mode: otRule.mode,
      hundredthHours: Math.round(Number(ot.hours || 0) * 100),
      parts: salarySplit && otRule.mode === 'pay' && ot.hours > 0
        ? overtimeByPart(records, otRule, salarySplit).map((h, i) => ({ hundredthHours: h, rates: salarySplit[i].rates }))
        : null,
      shiftHundredthHours: Math.round(shiftHours * 100),
      multiplier: multiplierRate(otRule.multiplier),
      base: otRule.base === 'basic_da' ? 'basic_da' : 'gross',
    },
    policy: {
      pf: ctx.pfPolicy,
      esi: ctx.esiApplicable,
      tds: ctx.tdsPolicy,
      wages: { fiftyPercent: wageRule.fiftyPercentRule },
      lwf: lwfThisMonth ? { employee: lwfThisMonth.employee, employer: lwfThisMonth.employer } : null,
      pt: {
        kind: pt.kind,
        rule: pt.rule,
        stateName: pt.state?.name || ptStateName || null,
        // The company's single monthly amount is for its own state only.
        manualAmount: ownPtState ? null : ctx.ptManualAmount,
      },
    },
    setup: {
      pf: setup.pf,
      esi: setup.esi,
      pt: setup.pt,
      tdsMode: setup.tdsMode,
      tdsFixed: toPaise(setup.tdsFixed),
      vpf: setup.vpfPercent > 0 ? rateOf(setup.vpfPercent) : null,
      optouts: setup.optouts,
    },
    customDeductions,
    rules: { epf, esi, overtime: otMinimum },
    ptHistory,
    esiCoveredEarlierInPeriod: Boolean(history?.esiCoveredEarlier),
    esiCoverageGross: salarySplit ? salaryParts[0].runningGross : null,
    rounding: calc.rounding.earnings,
    oneTime: oneTimeEarnings,
  };
  const R = toRupees;

  // Legacy payroll_components (Settings → Salary Structure), if a company
  // still has any: applied after the main calculation, in whole rupees.
  const skipNames = new Set(['basic', 'hra', 'da', 'special', 'special allowance', 'lop', 'pf', 'vpf', 'professional tax', 'pt', 'tds', 'esi', 'esic', 'overtime']);
  // Pay lost to unpaid days: the full month (at the split rates, in a month a
  // revision split) less what was earned.
  const lopOf = (o) => (o === out && splitMonthValue != null ? splitMonthValue : o.contractGross) - o.earnedGross;
  const legacyComponents = (o) => {
    const earnedIn = (code) => R(o.earnings.find((e) => e.code === code)?.earned || 0);
    const vars = {
      basic_salary: earnedIn('BASIC'),
      hra: earnedIn('HRA'),
      da: earnedIn('DA'),
      special: earnedIn('SPECIAL'),
      gross_salary: R(o.gross),
      unpaid_leave_days: round2(dayBase - o.paidDays),
      working_days: dayBase,
      lop_deduction: R(lopOf(o)),
      pf_deduction: R(o.pf.employee),
      professional_tax: R(o.pt.amount),
      // With TDS from the tax slabs it comes after these rules, within the pay left.
      tds_deduction: ctx.tdsPolicy === 'projected' ? 0 : R(o.tds),
      esi_deduction: R(o.esi.employee),
    };
    const result = {
      earnings: [], deductions: [], earningsTotal: 0, deductionsTotal: 0,
    };
    for (const c of ctx.components || []) {
      const name = String(c.name || '').trim().toLowerCase();
      if (skipNames.has(name)) continue;
      if (customOptions.some((opt) => String(opt.name || '').trim().toLowerCase() === name)) continue;
      const amount = R(Math.max(0, Math.round(toPaise(computeRule(vars, c)) / 100) * 100));
      if (amount <= 0) continue;
      if (c.type === 'EARNING') {
        result.earnings.push({ name: c.name, amount });
        result.earningsTotal += amount;
        vars.gross_salary += amount;
      } else {
        result.deductions.push({ name: c.name, amount });
        result.deductionsTotal += amount;
      }
      if (c.output_field) vars[String(c.output_field)] = amount;
    }
    return result;
  };

  // ── Income tax by projection (company TDS policy "projected") ───────────
  // Worked out on the month's pay without TDS, then charged as this
  // month's amount. A fixed amount or "none" set for the employee still
  // wins; the projection is then kept on the slip for information only.
  const taxProjected = ctx.tdsPolicy === 'projected';
  const tdsByProjection = taxProjected && setup.tdsMode === 'company';
  if (tdsByProjection) engineInput.setup.tdsFixed = 0;
  let out = payrollEngine.computePayslip(engineInput);
  const splitMonthValue = salarySplit
    ? payrollEngine.computePayslip({
      ...engineInput,
      oneTime: [],
      days: {
        basisDays: dayBase,
        paid: { num: splitFullShares.reduce((a, n) => a + n, 0), den: paid.den },
        segments: salarySplit.map((part, i) => ({ ...part, paid: { num: splitFullShares[i], den: paid.den } })),
      },
      overtime: { mode: 'off' },
    }).earnedGross
    : null;
  // A full month at the latest rates, with no unpaid days, overtime or one-time
  // pay — the monthly cost behind the CTC. (A month split by a revision is never one.)
  const fullMonth = paid.num === paid.den && out.overtimePay === 0 && !salarySplit && !oneTimeEarnings.length
    ? out
    : payrollEngine.computePayslip({
      ...engineInput, oneTime: [], days: { basisDays: dayBase, paid: { num: 1, den: 1 } }, overtime: { mode: 'off' },
    });
  let tax = null;
  if (taxProjected) {
    const taxYear = taxYearOf(payslipMonth, payslipYear);
    const profile = tdsProjection.resolveTaxProfile(salary, taxYear, calc.tds.defaultRegime);
    const legacyNow = legacyComponents(out);
    // The months to come are paid at today's salary — a raise applied since
    // this month (dated the 1st of next month, say) already counts for them.
    const futureFull = latestPart.salary === salary
      ? fullMonth
      : payrollEngine.computePayslip({
        ...engineInput, oneTime: [], components: componentsFor(salary).components, days: { basisDays: dayBase, paid: { num: 1, den: 1 } }, overtime: { mode: 'off' },
      });
    const fullMonthly = futureFull.gross + toPaise(legacyComponents(futureFull).earningsTotal);
    const leaving = lastWorkingDay || lastWorkingDayOf(employee);
    // The tax year's months still to come after this one: up to a known last
    // working day, and without later months already paid (a month generated late).
    const paidLater = new Set((history?.tax?.monthsCounted || []).map((x) => `${x.year}-${x.month}`));
    const comingMonths = [];
    for (let k = 1; k <= tdsProjection.futureMonthsFor(payslipMonth, payslipYear, leaving); k += 1) {
      const m = ((payslipMonth - 1 + k) % 12) + 1;
      const y = payslipYear + Math.floor((payslipMonth - 1 + k) / 12);
      if (!paidLater.has(`${y}-${m}`)) comingMonths.push({ month: m, year: y });
    }
    const futureMonths = comingMonths.length;
    // No payslips to look back on (a sample salary, a form not saved yet):
    // as if this pay had been paid every month of the tax year so far.
    const taxHistory = history?.tax || tdsProjection.steadyStateHistory({
      month: payslipMonth,
      year: payslipYear,
      profile,
      dateOfBirth: employee?.date_of_birth,
      monthly: fullMonthly,
      ptMonthly: futureFull.pt.amount,
    });
    tax = tdsProjection.projectMonthlyTds({
      month: payslipMonth,
      year: payslipYear,
      profile,
      dateOfBirth: employee?.date_of_birth,
      thisMonth: out.regularGross + toPaise(legacyNow.earningsTotal),
      oneTime: oneTimeEarnings.filter((i) => i.taxable).reduce((a, i) => a + i.amount, 0),
      futureMonthly: fullMonthly,
      futureMonths,
      comingMonths,
      lastWorkingDay: leaving,
      ptThisMonth: out.pt.amount,
      ptFutureMonthly: futureFull.pt.amount,
      ptFutureTotal: (() => {
        if (!setup.pt || !futureMonths) return 0;
        if (pt.kind !== 'slab' || pt.rule?.basis !== 'monthly') return futureFull.pt.amount * futureMonths;
        let total = 0;
        for (const coming of comingMonths) {
          total += payrollEngine.monthlyPt(pt.rule, futureFull.gross, { month: coming.month, gender: employee?.gender || null });
        }
        return total;
      })(),
      history: taxHistory,
      payAfterDeductions: out.gross + toPaise(legacyNow.earningsTotal) - out.totalDeductions - toPaise(legacyNow.deductionsTotal),
    });
    if (tdsByProjection && tax.tds > 0) {
      engineInput.setup.tdsFixed = tax.tds;
      out = payrollEngine.computePayslip(engineInput);
    }
  }

  const shownCodes = new Set(components.filter((c) => c.alwaysShown || c.monthly > 0).map((c) => c.code));
  const earnings = out.earnings
    .filter((e) => shownCodes.has(e.code) || e.earned > 0)
    .map((e) => ({ name: e.name, amount: R(e.earned), rate: R(e.rate) }));
  if (out.overtimePay > 0) earnings.push({ name: 'Overtime', amount: R(out.overtimePay) });
  const deductions = out.deductions.map((d) => ({ name: d.name, amount: R(d.amount) }));
  const earnedOf = (code) => R(out.earnings.find((e) => e.code === code)?.earned || 0);

  const legacy = legacyComponents(out);
  earnings.push(...legacy.earnings);
  deductions.push(...legacy.deductions);
  const legacyEarnings = legacy.earningsTotal;
  const legacyDeductions = legacy.deductionsTotal;

  // Loans and salary advances (Employee → Payroll): each instalment due this
  // month comes off after every other deduction, never more than the pay left;
  // what can't be recovered now stays on the loan for the months to come. The
  // recovery is recorded against the loan when the payslip is published.
  let room = Math.max(0, out.gross + toPaise(legacyEarnings) - out.totalDeductions - toPaise(legacyDeductions));
  // One-time recoveries first (notice not served, …), then loans.
  const oneTimeRecovered = [];
  let recoveryShort = 0;
  for (const r of oneTimeRecoveryItems) {
    const due = Math.max(0, Math.round(Number(r.amount) || 0));
    const take = Math.min(due, room);
    recoveryShort += due - take;
    room -= take;
    if (take > 0) oneTimeRecovered.push({ id: r.id, kind: r.kind, name: r.name, amount: R(take), due: R(due) });
  }
  deductions.push(...oneTimeRecovered.map((r) => ({ name: r.name, amount: r.amount })));
  const deductionsBeforeLoans = out.totalDeductions + toPaise(legacyDeductions)
    + oneTimeRecovered.reduce((s, r) => s + toPaise(r.amount), 0);
  const loanRecoveries = [];
  let loanShort = 0;
  for (const l of Array.isArray(loans) ? loans : []) {
    const due = Math.max(0, Math.round(Number(l.amount) || 0));
    const take = Math.min(due, room);
    loanShort += due - take;
    room -= take;
    if (take > 0) loanRecoveries.push({ loan_id: l.loanId, kind: l.kind, name: l.name, amount: R(take), due: R(due) });
  }
  deductions.push(...loanRecoveries.map((l) => ({ name: l.name, amount: l.amount })));
  const loanTotal = loanRecoveries.reduce((s, l) => s + toPaise(l.amount), 0);

  // In paise, then rupees: parts kept to the paisa must not pick up float error.
  const grossFinal = R(out.gross + toPaise(legacyEarnings));
  const totalDeductions = R(deductionsBeforeLoans + loanTotal);
  const net = R(toPaise(grossFinal) - toPaise(totalDeductions));
  const blockers = [...out.blockers, ...(tdsByProjection && tax ? tax.blockers : [])];
  if (ptEarlierDrafts.length) {
    blockers.push({ code: 'pt_earlier_draft', message: `An earlier payslip of this half-year is still a draft (${ptEarlierDrafts.map((d) => `${d.month}/${d.year}`).join(', ')}) — publish it first, so this month's Professional Tax counts it.` });
  }
  if (salaryHistoryGap) {
    const { missing = [], source } = salaryHistoryGap;
    const record = source
      ? `the ${source.which === 'previous' ? 'previous' : 'new'} salary recorded with the salary revision effective ${source.date}`
      : 'its salary revision';
    blockers.push({
      code: 'salary_history_incomplete',
      message: `The salary in force from ${salaryHistoryGap.from} can't be worked out: ${record} has no valid ${missing.join(', ') || 'amount'}. An applied revision can't be changed on screen — ask SpaxSync support to correct that record, then generate again.`,
    });
  }
  if (salaryProblems.length) {
    blockers.push({ code: 'salary_not_a_number', message: `${salaryProblems.join(', ')} in this employee's salary isn't a valid amount — fix it in Edit Employee.` });
  }
  if (ctx.ptStateUnconfirmed && setup.pt && !ownPtState) {
    blockers.push({ code: 'pt_state_unconfirmed', message: 'Confirm the company\'s Professional Tax state in Settings → Payroll (the earlier settings screen filled in Karnataka by itself).' });
  }
  const warnings = [...out.warnings, ...(tdsByProjection && tax ? tax.warnings : [])];
  const companyWarning = companyRules.companyValuesWarning(companyValues);
  if (companyWarning) warnings.push(companyWarning);
  if (recoveryShort > 0) {
    warnings.push({ code: 'recovery_short', message: `₹${R(recoveryShort).toLocaleString('en-IN')} of this month's recoveries couldn't be taken (not enough pay left) — recover it from the employee another way.` });
  }
  if (loanShort > 0) {
    warnings.push({ code: 'loan_short', message: `₹${R(loanShort).toLocaleString('en-IN')} of this month's loan instalment couldn't be recovered (not enough pay left); it stays on the loan.` });
  }
  if (net < 0 && !blockers.some((b) => b.code === 'negative_net')) {
    blockers.push({ code: 'negative_net', message: 'Deductions are more than this month\'s pay — lower the fixed TDS or other deductions.' });
  }
  const paidDays = round2(out.paidDays);
  const unpaidDays = round2(dayBase - out.paidDays);

  // Cost to company a month, as the company counts it — by default the
  // standard: gross + employer PF/EDLI/admin + employer ESI + the gratuity
  // provision (15/26 of a month's wages a year) + statutory bonus for those
  // eligible (wages up to ₹21,000), on the full month.
  const employerOf = (codes) => fullMonth.employer.filter((e) => codes.includes(e.code)).reduce((a, e) => a + e.amount, 0);
  const fullWages = fullMonth.pf.wages;
  const gratuityProvision = calc.ctc.gratuity ? mulDiv(fullWages, calc.gratuity.daysPerYear, calc.gratuity.divisor * 12) : 0;
  const bonusRate = percentRate(String(calc.bonus.percent));
  const bonusProvision = calc.ctc.bonus && fullWages > 0 && fullWages <= toPaise(calc.bonus.eligibilityCeiling)
    ? mulDiv(Math.min(fullWages, Math.max(toPaise(calc.bonus.calculationCeiling), toPaise(calc.bonus.minimumWage || 0))), bonusRate.num, bonusRate.den)
    : 0;
  // Employer LWF, paid only in the state's months, spread over the year.
  const lwfProvision = lwfRule ? mulDiv(lwfRule.employer * lwfRule.months.length, 1, 12) : 0;
  const ctcMonthly = fullMonth.contractGross
    + (calc.ctc.employerPf ? employerOf(['EPS', 'EPF_ER', 'EDLI', 'EPF_ADMIN']) : 0)
    + (calc.ctc.employerEsi ? employerOf(['ESI_ER']) : 0)
    + gratuityProvision + bonusProvision + lwfProvision;
  const ruleRefOf = (rule) => (rule
    ? { ...statutory.ruleRef(rule), ...(rule.companyValues ? { company_values: rule.companyValues } : {}) }
    : null);

  const breakdown_json = {
    earnings,
    deductions,
    employer_contributions: out.employer.map((e) => ({ name: e.name, amount: R(e.amount) })),
    totals: {
      gross_salary: grossFinal,
      total_deductions: totalDeductions,
      net_pay: Math.max(0, net),
      employer_contributions: R(out.employerTotal),
    },
    config: {
      engine: 2,
      rounding: calc.rounding.earnings === 'paise' ? 'each_part_to_paisa' : 'each_part_to_rupee',
      working_days: dayBase,
      working_days_in_month: workingDaysInMonth,
      days_in_month: daysInMonth,
      day_rate_basis: rules.dayRateBasis,
      per_day_rate: round2(R(out.contractGross) / dayBase),
      working_days_setting: ctx.workingDaysSetting,
      paid_days: paidDays,
      unpaid_leave_days: unpaidDays,
      absent,
      half_day: halfDay,
      not_employed_days: notEmployedDays,
      paid_share: paid,
      joined_on: joinedOn,
      left_on: lastWorkingDay,
      late_count: lateCount,
      late_penalty_days: latePenalty,
      late_rule: rules.late,
      leave_cover: leaveCover.days > 0 || leaveCover.applied
        ? { ...leaveCover, applied: Boolean(leaveCover.applied) }
        : null,
      overtime: {
        mode: otRule.mode,
        base: otRule.base === 'basic_da' ? 'basic_da' : 'gross',
        hours: ot.hours,
        uncapped_hours: ot.uncappedHours,
        days: ot.days,
        multiplier: otRule.multiplier,
        pay: R(out.overtimePay),
        comp_off_days: compOffDays,
        comp_off_credited: published ? (previousConfig?.overtime?.comp_off_credited ?? null) : null,
      },
      contract_gross: R(out.contractGross),
      // The salary in force during the month, when it was not simply today's:
      // each part of the month and its monthly gross.
      salary_periods: salaryParts.length > 1 || salaryParts[0].salary !== salary
        ? salaryParts.map((part) => ({ from: part.from, to: part.to, monthly_gross: R(part.runningGross) }))
        : null,
      ctc_monthly: R(ctcMonthly),
      ctc_provisions: { gratuity: R(gratuityProvision), bonus: R(bonusProvision), lwf: R(lwfProvision) },
      earned_gross: R(out.earnedGross),
      earned_basic: earnedOf('BASIC'),
      lop_amount: R(lopOf(out)),
      pf_policy: ctx.pfPolicy,
      pf_applicable: setup.pf,
      pf_rate: epf ? epf.employeeRate.num / epf.employeeRate.den : null,
      // Labour Code wages: the parts counted as wages + the 50% rule's add-back.
      pf_wages: R(out.pf.wages),
      wages_add_back: R(out.pf.wageAddBack || 0),
      wage_components: wageRule.codes,
      fifty_percent_rule: wageRule.fiftyPercentRule,
      pf_wages_used: R(out.pf.wagesUsed),
      eps_wages: R(out.pf.epsWages),
      edli_wages: R(out.pf.edliWages),
      pf_ceiling: epf ? R(epf.wageCeiling) : null,
      esi_policy: ctx.esiApplicable,
      esi_applicable: setup.esi,
      esi_eligible: out.esi.covered,
      esi_exempt: out.esi.exempt,
      // Calendar days paid for (weekly offs included) — ESI's ₹176-a-day test and its monthly return.
      esi_paid_days: esiPaidDays.num / 2,
      esi_threshold: esi ? R(esi.coverageCeiling) : null,
      esi_deduction: R(out.esi.employee),
      pt_state: pt.state?.name || ptStateName || null,
      pt_state_own: ownPtState,
      // Labour Welfare Fund this month (the company's amounts for the employee's state).
      lwf: out.lwf.employee > 0 || out.lwf.employer > 0
        ? { state: lwfStateName, employee: R(out.lwf.employee), employer: R(out.lwf.employer) }
        : null,
      pt_company_slabs: pt.rule?.id === COMPANY_PT_RULE_ID,
      pt_kind: out.pt.kind,
      pt_applicable: setup.pt,
      professional_tax: R(out.pt.amount),
      pt_half_year_amount: out.pt.halfYearAmount != null ? R(out.pt.halfYearAmount) : null,
      tds_policy: ctx.tdsPolicy,
      tds_mode: setup.tdsMode,
      // The tax working behind this month's TDS (rupees); `applied` is false
      // when a fixed amount or "none" set for the employee was used instead.
      tax: tax?.worksheet ? { ...taxWorksheetInRupees(tax.worksheet), applied: tdsByProjection } : null,
      opted_out: out.skippedCustom,
      // One-time pay and recoveries on this payslip (Employee → Payroll; full and final).
      one_time: oneTimeItems.length
        ? [
          ...oneTimeEarnings.map((i) => ({
            id: i.code.slice('ONE_TIME:'.length), name: i.name, earning: true, amount: R(i.amount), taxable: i.taxable, pf_wage: i.pfWage, esi_wage: i.esiWage,
          })),
          ...oneTimeRecovered.map((r) => ({ ...r, earning: false })),
        ]
        : null,
      one_time_pay: R(out.oneTimePay || 0),
      // Loan and advance instalments recovered on this payslip (recorded when it is published).
      loans: loanRecoveries.length ? loanRecoveries : null,
      // What the payslip shows, as the company chose when it was worked out.
      payslip_display: {
        show_rates: calc.payslip.showRates,
        show_employer: calc.payslip.showEmployer,
        show_tax_working: calc.payslip.showTaxWorking,
      },
      // Values the company set that differ from the law: [{ key, label, law, company }].
      company_values: companyValues.length ? companyValues : null,
      rules: {
        epf: ruleRefOf(epf),
        esi: ruleRefOf(esi),
        pt: statutory.ruleRef(pt.rule),
        overtime: statutory.ruleRef(otMinimum),
      },
      warnings,
      blockers,
    },
  };

  return {
    basic_salary: earnedOf('BASIC'),
    hra: earnedOf('HRA'),
    special_allowance: earnedOf('SPECIAL'),
    transport_allowance: earnedOf('TRANSPORT'),
    medical_allowance: earnedOf('MEDICAL'),
    gross_salary: grossFinal,
    unpaid_leave_days: unpaidDays,
    // The pay lost to unpaid days — for reports; it is already out of the
    // earned figures, so it is not a deduction.
    lop_deduction: R(lopOf(out)),
    pf_deduction: R(out.pf.employee),
    professional_tax: R(out.pt.amount),
    esi_deduction: R(out.esi.employee),
    overtime_pay: R(out.overtimePay),
    tds: R(out.tds),
    total_deductions: totalDeductions,
    net_salary: Math.max(0, net),
    breakdown_json,
  };
};

/** The six-month period a month belongs to (April–September or October–March): its first month, and the months left including this one. */
const halfYearStart = (month, year) => {
  if (month >= 4 && month <= 9) return { month: 4, year };
  return month >= 10 ? { month: 10, year } : { month: 10, year: year - 1 };
};
const monthsLeftInHalfYear = (month) => {
  if (month >= 4 && month <= 9) return 10 - month;
  return month >= 10 ? 16 - month : 4 - month;
};

/**
 * What this six-month period's earlier payslips say, for the two rules that
 * look back: Tamil Nadu's half-yearly PT (the income and PT so far) and ESI
 * (once covered in a contribution period, an employee stays covered to its
 * end). Published payslips only — drafts can still change.
 */
const loadPeriodHistory = async (employeeId, month, year, ctx, ptState = null) => {
  if (!employeeId || !month || !year) return null;
  const onDate = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const ptHalfYearly = statutory.ptRule(ptState || ctx.ptState, onDate).rule?.basis === 'half_yearly';
  if (!ptHalfYearly && !ctx.esiApplicable) return null;
  const earlier = [];
  const cursor = halfYearStart(month, year);
  while (!(cursor.month === month && cursor.year === year)) {
    earlier.push({ month: cursor.month, year: cursor.year });
    cursor.month += 1;
    if (cursor.month === 13) { cursor.month = 1; cursor.year += 1; }
  }
  let rows = [];
  let drafts = [];
  if (earlier.length) {
    const { data, error } = await supabaseAdmin
      .from('payroll')
      .select('month, year, gross_salary, professional_tax, breakdown_json, payslip_status')
      .eq('employee_id', employeeId)
      .in('year', [...new Set(earlier.map((p) => p.year))]);
    if (error) throw new BadRequestError(error.message);
    const inPeriod = (data || []).filter((r) => earlier.some((p) => p.month === Number(r.month) && p.year === Number(r.year)));
    rows = inPeriod.filter((r) => String(r.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.PUBLISHED);
    drafts = inPeriod.filter((r) => String(r.payslip_status || '').toUpperCase() !== PAYSLIP_STATUS.PUBLISHED);
  }
  // The half-year's PT is the state's own: months whose PT went to another
  // state (the employee moved) don't count towards it.
  const stateName = statutory.findState(ptState || ctx.ptState)?.name || null;
  const sameState = (r) => (r.breakdown_json?.config?.pt_state || null) === stateName;
  const ptRows = rows.filter(sameState);
  return {
    pt: {
      grossBefore: ptRows.reduce((s, r) => s + toPaise(r.gross_salary), 0),
      paidBefore: ptRows.reduce((s, r) => s + toPaise(r.professional_tax), 0),
      monthsLeft: monthsLeftInHalfYear(month),
    },
    esiCoveredEarlier: rows.some((r) => r.breakdown_json?.config?.esi_eligible === true),
    // Half-yearly PT counts published months only; an earlier draft of the same state must be published first.
    ptEarlierDrafts: drafts.filter(sameState).map((r) => ({ month: Number(r.month), year: Number(r.year) })),
  };
};

/** The tax year's months before this one: April … last month. */
const taxYearMonthsBefore = (month, year) => {
  const list = [];
  let m = 4;
  let y = month >= 4 ? year : year - 1;
  for (let i = 0; i < 12 && !(m === month && y === year); i += 1) {
    list.push({ month: m, year: y });
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return list;
};

/**
 * This tax year's payslips before this month, in this company — what TDS by
 * projection counts as already paid and deducted. A real run counts
 * published payslips only and lists earlier drafts (they must be published
 * first, or this month's TDS would miss them); a preview counts drafts too,
 * as the best estimate.
 */
/** A payslip's gross that is taxable salary: one-time pay marked not taxable (e.g. exempt gratuity) left out. */
const taxableGrossOf = (row) => {
  const exempt = (row?.breakdown_json?.config?.one_time || [])
    .filter((i) => i && i.earning && i.taxable === false)
    .reduce((s, i) => s + toPaise(i.amount), 0);
  return Math.max(0, toPaise(row?.gross_salary) - exempt);
};

const loadTaxYearHistory = async (employee, month, year, { countDrafts = false } = {}) => {
  const earlier = taxYearMonthsBefore(month, year);
  // Months after this one in the tax year (a month generated late): only
  // published ones count, and they are then no longer "still to come".
  const later = [];
  {
    let m = month;
    let y = year;
    while (!(m === 3 && y === (month >= 4 ? year + 1 : year))) {
      m += 1;
      if (m === 13) { m = 1; y += 1; }
      later.push({ month: m, year: y });
      if (later.length > 12) break;
    }
  }
  const history = {
    salaryPaid: 0, tdsPaid: 0, ptPaid: 0, earlierDrafts: [], monthsCounted: [],
  };
  if (!employee?.id || (!earlier.length && !later.length)) return history;
  const { getCompanyId } = require('../utils/tenant');
  const companyId = getCompanyId(employee);
  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select('month, year, gross_salary, tds, professional_tax, payslip_status, company_id, breakdown_json')
    .eq('employee_id', employee.id)
    .in('year', [...new Set([...earlier, ...later].map((p) => p.year))]);
  if (error) throw new BadRequestError(error.message);
  const sameCompany = (r) => !r.company_id || !companyId || String(r.company_id) === String(companyId);
  const rows = (data || []).filter((r) => earlier.some((p) => p.month === Number(r.month) && p.year === Number(r.year)) && sameCompany(r));
  const isPublished = (r) => String(r.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.PUBLISHED;
  for (const r of (data || []).filter((x) => later.some((p) => p.month === Number(x.month) && p.year === Number(x.year)) && sameCompany(x) && isPublished(x))) {
    history.salaryPaid += taxableGrossOf(r);
    history.tdsPaid += toPaise(r.tds);
    history.ptPaid += toPaise(r.professional_tax);
    history.monthsCounted.push({ month: Number(r.month), year: Number(r.year) });
  }
  for (const r of rows) {
    if (!countDrafts && !isPublished(r)) {
      history.earlierDrafts.push({ month: Number(r.month), year: Number(r.year) });
      continue;
    }
    history.salaryPaid += taxableGrossOf(r);
    history.tdsPaid += toPaise(r.tds);
    history.ptPaid += toPaise(r.professional_tax);
    history.monthsCounted.push({ month: Number(r.month), year: Number(r.year) });
  }
  return history;
};

/**
 * A payslip for one employee and month. `summary`/`records` come from
 * attendanceService.getMonthlySummary. opts: { year, records, ctx (reuse a
 * loaded payroll context), published, previousConfig, withHistory (look up
 * this period's published payslips — real runs; previews don't) }.
 * With TDS by projection, the tax year's payslips are looked up either way:
 * a real run counts the published ones, a preview its drafts too.
 */
const calculateContractPayslip = async (employee, attendanceSummary, month = null, opts = {}) => {
  const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
  const companyId = getCompanyId(employee) || DEFAULT_COMPANY_ID;
  const year = Number(opts.year) || moment.tz(TIMEZONE).year();
  const ctx = opts.ctx || await loadPayrollContext(companyId);
  const summary = attendanceSummary || {};
  let leaveAvailable = 0;
  if (!opts.published && ctx.leaveFirst && (Number(summary.absent || 0) > 0 || Number(summary.payHalfDay ?? summary.halfDay ?? 0) > 0) && employee?.id) {
    leaveAvailable = await availableLeaveDays(employee.id, year, companyId);
  }
  let history = opts.withHistory
    ? await loadPeriodHistory(employee?.id, Number(month), year, ctx, resolvePayrollSetup(employee?.salary_details).ptState)
    : null;
  // Real runs use the salary in force during the month (revisions applied since).
  const revisions = opts.withHistory && employee?.id && Number(month)
    ? await loadAppliedRevisions(employee.id)
    : null;
  if (ctx.tdsPolicy === 'projected' && employee?.id) {
    const forMonth = Number(month) || (moment.tz(TIMEZONE).month() + 1);
    const tax = await loadTaxYearHistory(employee, forMonth, year, { countDrafts: !opts.withHistory });
    history = { ...(history || {}), tax };
  }
  // One-time pay and recoveries for the month (real runs; none before the SQL is run).
  const oneTime = opts.withHistory && employee?.id && Number(month) && !opts.published
    ? await require('./oneTimePay.service').itemsDue(employee.id, Number(month), year)
    : null;
  // Loan and advance instalments due this month (real runs; none before the SQL is run).
  // A leaver's final payslip (or settlement payslip) recovers what is left of each loan.
  const leftOn = lastWorkingDayOf(employee);
  const finalPay = Boolean(leftOn) && Number(leftOn.slice(0, 4)) * 12 + Number(leftOn.slice(5, 7)) <= year * 12 + Number(month);
  const loans = opts.withHistory && employee?.id && Number(month) && !opts.published
    ? await require('./employeeLoan.service').recoveriesDue(employee.id, Number(month), year, { finalPay })
    : null;
  return computePayslip(ctx, {
    employee,
    summary,
    records: opts.records || [],
    month,
    year,
    leaveAvailable,
    published: Boolean(opts.published),
    previousConfig: opts.previousConfig || null,
    history,
    revisions,
    loans,
    oneTime,
  });
};

/** Someone's last working day, if they have left (or are leaving): the recorded date, else the day they were offboarded. */
const lastWorkingDayOf = (employee) => {
  if (employee?.last_working_day) return String(employee.last_working_day).slice(0, 10);
  if (employee?.employment_status === 'offboarded' && employee?.offboarded_at) {
    return moment(employee.offboarded_at).tz(TIMEZONE).format('YYYY-MM-DD');
  }
  return null;
};

/**
 * The month after a leaver's last month: their settlement month. Its payslip
 * pays only one-time pay (a full and final settlement added after the last
 * month's payslip was published); nothing regular is due.
 */
const isSettlementMonth = (employee, month, year) => {
  const lwd = lastWorkingDayOf(employee);
  if (!lwd) return false;
  const index = Number(lwd.slice(0, 4)) * 12 + Number(lwd.slice(5, 7));
  return Number(year) * 12 + Number(month) === index + 1;
};

/**
 * Whether someone was employed during the month — anyone active, plus
 * anyone who left during it (defect D7: leavers used to be skipped and got
 * no pay for their last month).
 */
const employmentInMonth = (employee, month, year) => {
  const start = ymd(year, month, 1);
  const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const joined = employee?.date_of_joining ? String(employee.date_of_joining).slice(0, 10) : null;
  if (joined && joined > end) return { employed: false, reason: 'Joins after this month' };
  const lastWorkingDay = lastWorkingDayOf(employee);
  if (employee?.is_active === false) {
    if (!lastWorkingDay) return { employed: false, reason: 'Not active' };
    if (lastWorkingDay < start) return { employed: false, reason: 'Left before this month' };
  }
  return { employed: true, lastWorkingDay: lastWorkingDay && lastWorkingDay <= end ? lastWorkingDay : null };
};

/** A month's payroll can be run once the month is over (attendance counts the full month). */
const monthHasEnded = (month, year) => {
  const nextStart = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).add(1, 'month').startOf('month');
  return !moment.tz(TIMEZONE).isBefore(nextStart);
};
/**
 * A leaver's last working day is over (it falls in the payslip's month and
 * is before today): their final payslip can be made now — final dues are
 * payable within 2 working days of leaving (Code on Wages s.17) — every day
 * they could work is counted.
 */
const leaverFinalMonthReady = (lastWorkingDay, month, year) => {
  const lwd = String(lastWorkingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lwd)) return false;
  if (Number(lwd.slice(0, 4)) !== Number(year) || Number(lwd.slice(5, 7)) !== Number(month)) return false;
  return lwd < moment.tz(TIMEZONE).format('YYYY-MM-DD');
};
const monthNotOverMessage = (month, year) => {
  const start = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE);
  return `${start.format('MMMM YYYY')} isn't over yet — its payroll can be run from ${start.clone().add(1, 'month').format('D MMMM YYYY')}, once every day of the month is counted.`;
};

/**
 * What one employee's monthly pay works out to under the current settings,
 * for a full month with no leave deducted — the same calculation a payslip
 * uses, so the profile's figures match what payroll will produce. (The
 * profile used to work this out in the browser with hard-coded numbers: a
 * ₹200 professional tax whenever PT was 0, and always 8% TDS.)
 */
const previewEmployeeSalary = async (employeeId) => {
  const { data: employee, error } = await selectEmployeeForPayroll(employeeId);
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

const MAX_FIXED_TDS = 10000000;

/** The PF and ESI limits payroll uses today (the company's values over the law), in rupees — for the reminders next to a switch. */
const statutoryLimitsToday = (calc = null) => {
  const today = moment.tz(TIMEZONE).format('YYYY-MM-DD');
  const epf = companyRules.companyEpf(statutory.epfRule(today), calc).rule;
  const esi = companyRules.companyEsi(statutory.esiRule(today), calc).rule;
  return {
    pfCeiling: epf ? toRupees(epf.wageCeiling) : null,
    esiThreshold: esi ? toRupees(esi.coverageCeiling) : null,
    esiThresholdPwd: esi ? toRupees(esi.pwdCoverageCeiling) : null,
  };
};

const customDeductionOptions = (payrollConfig) => (Array.isArray(payrollConfig?.custom_payroll_options)
  ? payrollConfig.custom_payroll_options
  : []
).filter((o) => o && o.active !== false && String(o.name || '').trim()
  && !['allowance', 'earning'].includes(String(o.kind || o.type || 'deduction').toLowerCase()));

const tdsLabel = (mode, fixed) => {
  if (mode === 'none') return 'None';
  if (mode === 'company') return 'As the company setting';
  return `₹${Number(fixed || 0).toLocaleString('en-IN')} a month`;
};

/** An identifier shown only by its last four characters (the change emails go to admins). */
const maskedId = (v) => (v ? `ending ${String(v).slice(-4)}` : 'Not recorded');
const rupeesLabel = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

const TAX_AMOUNT_LABELS = {
  previous_employer_income: 'Salary from previous employer',
  previous_employer_tds: 'TDS by previous employer',
  earlier_income: 'Salary paid outside SpaxSync',
  earlier_tds: 'TDS on salary paid outside SpaxSync',
  other_income: 'Other income declared',
  hra_exemption: 'HRA exemption (old regime)',
  lta_exemption: 'LTA exemption (old regime)',
  chapter8_deductions: 'Chapter VIII deductions (old regime)',
  other_deductions: 'Other deductions (old regime)',
};

/** The current tax year and every year either setup has tax inputs for. */
const setupTaxYears = (...setups) => {
  const now = moment.tz(TIMEZONE);
  const years = new Set([taxYearOf(now.month() + 1, now.year())]);
  for (const s of setups) for (const y of Object.keys(s?.taxYears || {})) years.add(y);
  return [...years].sort();
};

/** Human-readable state of every switch, keyed for comparing before/after. */
const describeSetup = (setup, options, taxYears = [taxYearOf(moment.tz(TIMEZONE).month() + 1, moment.tz(TIMEZONE).year())]) => {
  const rows = [
    { key: 'pf', label: 'PF', value: setup.pf ? 'Deducted' : 'Not deducted' },
    { key: 'vpf', label: 'VPF', value: setup.vpfPercent > 0 ? `${setup.vpfPercent}%` : 'None' },
    { key: 'eps', label: 'EPS (pension) member', value: setup.epsEligible ? 'Yes' : 'No' },
    { key: 'esi', label: 'ESI', value: setup.esi ? 'Deducted' : 'Not deducted' },
    { key: 'pwd', label: 'Person with disability', value: setup.isPwd ? 'Yes' : 'No' },
    { key: 'pt', label: 'Professional Tax', value: setup.pt ? 'Deducted' : 'Not deducted' },
    { key: 'pt_state', label: 'Professional Tax state', value: setup.ptState || 'The company\'s state' },
    { key: 'tds', label: 'TDS', value: tdsLabel(setup.tdsMode, setup.tdsFixed) },
    { key: 'pan', label: 'PAN', value: maskedId(setup.statutoryIds?.pan) },
    { key: 'uan', label: 'UAN', value: maskedId(setup.statutoryIds?.uan) },
    { key: 'esic_ip', label: 'ESIC number', value: maskedId(setup.statutoryIds?.esicIp) },
  ];
  for (const ty of [...new Set(taxYears)]) {
    const p = tdsProjection.resolveTaxProfile({ tax_profile: { years: setup.taxYears || {} } }, ty);
    let regimeLabel = 'Not chosen (company default)';
    if (p.regimeChosen) regimeLabel = p.regime === 'old' ? 'Old regime' : 'New regime';
    rows.push({ key: `tax:${ty}:regime`, label: `Tax regime ${ty}`, value: regimeLabel });
    for (const k of tdsProjection.PROFILE_AMOUNTS) {
      rows.push({ key: `tax:${ty}:${k}`, label: `${TAX_AMOUNT_LABELS[k]} ${ty}`, value: rupeesLabel(toRupees(p[k])) });
    }
  }
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
const setupWarnings = (setup, {
  pfWages, contractGross, pfCeiling, esiThreshold, pfPolicy, esiApplicable, tdsPolicy,
}) => {
  const w = [];
  if (!setup.pf && pfPolicy !== 'not_applicable' && pfCeiling != null && pfWages <= pfCeiling) {
    w.push({ key: 'pf', message: `PF is compulsory when Basic + DA is ₹${Math.round(pfCeiling).toLocaleString('en-IN')} or less (here ₹${Math.round(pfWages).toLocaleString('en-IN')}).` });
  }
  if (!setup.esi && esiApplicable && esiThreshold != null && contractGross <= esiThreshold) {
    w.push({ key: 'esi', message: `ESI is compulsory when monthly gross is ₹${Math.round(esiThreshold).toLocaleString('en-IN')} or less (here ₹${Math.round(contractGross).toLocaleString('en-IN')}).` });
  }
  if (!setup.pt) {
    w.push({ key: 'pt', message: 'Professional Tax is set by state law — switch it off only where the state exempts this employee.' });
  }
  if (setup.tdsMode === 'none') {
    w.push({ key: 'tds', message: 'No TDS will be deducted. Make sure the employee\'s tax declarations support this.' });
  }
  if (tdsPolicy === 'projected' && setup.tdsMode === 'company' && !setup.statutoryIds?.pan) {
    w.push({ key: 'pan', message: 'No PAN recorded. Without a PAN the law can require TDS at a higher rate — check with your CA.' });
  }
  return w;
};

const loadEmployeeForPayroll = async (employeeId) => {
  const { data: employee, error } = await selectEmployeeForPayroll(employeeId);
  if (error) throw new BadRequestError(error.message);
  if (!employee) throw new NotFoundError('Employee not found');
  return employee;
};

const getPayrollSetup = async (employeeId) => {
  const employee = await loadEmployeeForPayroll(employeeId);
  const { getCompanyId } = require('../utils/tenant');
  const ctx = await loadPayrollContext(getCompanyId(employee));
  const setup = resolvePayrollSetup(employee.salary_details);
  const now = moment.tz(TIMEZONE);
  const taxHistory = ctx.tdsPolicy === 'projected'
    ? await loadTaxYearHistory(employee, now.month() + 1, now.year(), { countDrafts: true })
    : null;
  const preview = computePayslip(ctx, {
    employee, summary: {}, records: [], history: taxHistory ? { tax: taxHistory } : null,
  });
  const cfg = preview.breakdown_json.config;
  const options = customDeductionOptions(ctx.payrollConfig);
  const amountOf = (name) => preview.breakdown_json.deductions.find((d) => d.name === name)?.amount ?? null;
  const optedOut = new Set(setup.optouts);
  const sd = employee.salary_details || {};
  const limits = statutoryLimitsToday(ctx.calc);
  return {
    employeeId,
    pf: setup.pf,
    vpfPercent: setup.vpfPercent,
    esi: setup.esi,
    esiChosen: sd.esi_set === true,
    pt: setup.pt,
    ptState: setup.ptState,
    tdsMode: setup.tdsMode,
    tdsFixed: setup.tdsFixed,
    isPwd: setup.isPwd,
    epsEligible: setup.epsEligible,
    statutoryIds: setup.statutoryIds,
    // This tax year's income-tax inputs (rupees) and this month's tax working, if TDS is projected.
    tax: (() => {
      const taxYear = taxYearOf(now.month() + 1, now.year());
      const p = tdsProjection.resolveTaxProfile(sd, taxYear, companyRules.resolveCompanyCalc(ctx.calc).tds.defaultRegime);
      const amounts = Object.fromEntries(tdsProjection.PROFILE_AMOUNTS.map((k) => [k, toRupees(p[k])]));
      return {
        taxYear,
        regime: p.regime,
        regimeChosen: p.regimeChosen,
        ...amounts,
        worksheet: cfg.tax || null,
        dateOfBirth: employee.date_of_birth || null,
      };
    })(),
    company: {
      pfPolicy: ctx.pfPolicy,
      esiApplicable: ctx.esiApplicable,
      tdsPolicy: ctx.tdsPolicy,
      ptState: ctx.ptState || null,
    },
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
      pfWages: cfg.pf_wages,
      gross: cfg.contract_gross,
      esiThreshold: setup.isPwd ? limits.esiThresholdPwd : limits.esiThreshold,
      esiEligible: cfg.esi_eligible,
      pfCeiling: limits.pfCeiling,
      // Kept for older screens: the PF limit to compare Basic + DA against.
      pfStatutoryBasic: limits.pfCeiling,
    },
    amounts: {
      pf: amountOf('PF'), vpf: amountOf('VPF'), esi: amountOf('ESI'), pt: amountOf('Professional Tax'), tds: amountOf('TDS'),
    },
    employerContributions: preview.breakdown_json.employer_contributions,
    preview: { gross: preview.gross_salary, net: preview.net_salary, totalDeductions: preview.breakdown_json.totals.total_deductions },
    blockers: cfg.blockers || [],
    warnings: setupWarnings(setup, {
      pfWages: cfg.pf_wages,
      contractGross: cfg.contract_gross,
      pfCeiling: limits.pfCeiling,
      esiThreshold: setup.isPwd ? limits.esiThresholdPwd : limits.esiThreshold,
      pfPolicy: ctx.pfPolicy,
      esiApplicable: ctx.esiApplicable,
      tdsPolicy: ctx.tdsPolicy,
    }),
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
  const beforeSetup = resolvePayrollSetup(beforeSalary);
  const afterSetup = resolvePayrollSetup(afterSalary);
  const years = setupTaxYears(beforeSetup, afterSetup);
  const beforeRows = describeSetup(beforeSetup, options, years);
  const afterRows = describeSetup(afterSetup, options, years);
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
// 1.1 × 100 is 110.00000000000001 in floating point, so compare with a tolerance.
const hasAtMostTwoDecimals = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** PAN, UAN and ESIC number as typed by HR: checked for shape, '' clears one. */
const validateStatutoryIds = (input, current) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestError('Statutory numbers must be sent as an object');
  const out = { ...current };
  if (input.pan !== undefined) {
    const pan = String(input.pan ?? '').trim().toUpperCase();
    if (pan && !PAN_PATTERN.test(pan)) throw new BadRequestError('PAN must be 10 characters: 5 letters, 4 digits, 1 letter (like ABCDE1234F)');
    out.pan = pan;
  }
  if (input.uan !== undefined) {
    const uan = String(input.uan ?? '').replace(/\s+/g, '');
    if (uan && !/^\d{12}$/.test(uan)) throw new BadRequestError('UAN must be 12 digits');
    out.uan = uan;
  }
  if (input.esicIp !== undefined) {
    const ip = String(input.esicIp ?? '').replace(/\s+/g, '');
    if (ip && !/^\d{10}$/.test(ip)) throw new BadRequestError('ESIC number (IP number) must be 10 digits');
    out.esicIp = ip;
  }
  return out;
};

const MAX_TAX_AMOUNT = 1000000000; // ₹100 crore
/**
 * One tax year's income-tax inputs from the Payroll setup card, merged into
 * what is saved. Last, this or next tax year only.
 */
const validateTaxYearChange = (input, currentYears) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestError('Tax details must be sent as an object');
  const ty = String(input.taxYear || '');
  const m = /^(\d{4})-(\d{2})$/.exec(ty);
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100) throw new BadRequestError('Tax year must look like 2026-27');
  const now = moment.tz(TIMEZONE);
  const currentStart = Number(taxYearOf(now.month() + 1, now.year()).slice(0, 4));
  if (Math.abs(Number(m[1]) - currentStart) > 1) throw new BadRequestError('Tax details can be recorded for last, this or next tax year only');
  const year = { ...(currentYears?.[ty] || {}) };
  if (input.regime !== undefined) {
    if (!tdsProjection.REGIMES.includes(input.regime)) throw new BadRequestError('Tax regime must be new or old');
    year.regime = input.regime;
  }
  for (const k of tdsProjection.PROFILE_AMOUNTS) {
    if (input[k] === undefined) continue;
    const n = input[k] === '' || input[k] === null ? 0 : Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > MAX_TAX_AMOUNT || !hasAtMostTwoDecimals(n)) {
      throw new BadRequestError(`${TAX_AMOUNT_LABELS[k]} must be between ₹0 and ₹100 crore`);
    }
    year[k] = round2(n);
  }
  return { ...(currentYears || {}), [ty]: year };
};

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
  if (changes.vpfPercent !== undefined) {
    const v = Number(changes.vpfPercent);
    if (!Number.isFinite(v) || v < 0 || v > 100 || !hasAtMostTwoDecimals(v)) throw new BadRequestError('VPF must be between 0% and 100%, up to two decimals');
    next.vpfPercent = v;
  }
  if (changes.esi !== undefined) next.esi = bool(changes.esi, 'ESI');
  if (changes.pt !== undefined) next.pt = bool(changes.pt, 'Professional Tax');
  if (changes.ptState !== undefined) {
    if (changes.ptState === null || changes.ptState === '') next.ptState = null;
    else {
      const st = statutory.findState(changes.ptState);
      if (!st) throw new BadRequestError('Choose the state this employee works in from the list');
      next.ptState = st.name;
    }
  }
  if (changes.tdsMode !== undefined) {
    if (!['company', 'fixed', 'none'].includes(changes.tdsMode)) throw new BadRequestError('TDS must follow the company setting, be a fixed amount, or none');
    next.tdsMode = changes.tdsMode;
  }
  if (changes.tdsFixed !== undefined) {
    const n = Number(changes.tdsFixed);
    if (!Number.isFinite(n) || n < 0 || n > MAX_FIXED_TDS) throw new BadRequestError('Enter a fixed TDS amount between ₹0 and ₹1,00,00,000');
    next.tdsFixed = round2(n);
  }
  if (next.tdsMode === 'fixed' && !(next.tdsFixed > 0)) throw new BadRequestError('Enter the fixed monthly TDS amount');
  if (changes.isPwd !== undefined) next.isPwd = bool(changes.isPwd, 'Person with disability');
  if (changes.epsEligible !== undefined) next.epsEligible = bool(changes.epsEligible, 'EPS membership');
  if (changes.statutoryIds !== undefined) {
    next.statutoryIds = validateStatutoryIds(changes.statutoryIds, before.statutoryIds);
  }
  if (changes.tax !== undefined) {
    next.taxYears = validateTaxYearChange(changes.tax, before.taxYears);
  }
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

  const years = setupTaxYears(before, next);
  const beforeRows = describeSetup(before, options, years);
  const afterRows = describeSetup(next, options, years);
  const diff = afterRows
    .map((r) => ({ ...r, from: beforeRows.find((b) => b.key === r.key)?.value }))
    .filter((r) => r.from !== r.value);
  const esiNewlyChosen = changes.esi !== undefined && employee.salary_details?.esi_set !== true;
  if (!diff.length && !esiNewlyChosen) return { changes: [], setup: await getPayrollSetup(employeeId), notified: false };

  const nowIso = new Date().toISOString();
  const salaryDetails = {
    ...(employee.salary_details || {}),
    pf_applicable: next.pf,
    vpf_percent: next.vpfPercent,
    pt_applicable: next.pt,
    pt_state: next.ptState || null,
    esi_applicable: next.esi,
    ...(changes.esi !== undefined ? { esi_set: true } : {}),
    tds_mode: next.tdsMode,
    tds_fixed: next.tdsFixed,
    deduction_optouts: next.optouts,
    is_pwd: next.isPwd,
    eps_eligible: next.epsEligible,
    statutory_ids: { pan: next.statutoryIds.pan, uan: next.statutoryIds.uan, esic_ip: next.statutoryIds.esicIp },
    tax_profile: { ...(employee.salary_details?.tax_profile || {}), years: next.taxYears },
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

// ── Calculation values (Settings → Payroll → Calculation) ──────────────────

/**
 * The legal values in force today and the standard, shown beside each value
 * a company can change — read-only, the same for every company.
 */
const getCalcDefaults = () => {
  const today = moment.tz(TIMEZONE).format('YYYY-MM-DD');
  const epf = statutory.epfRule(today);
  const esi = statutory.esiRule(today);
  const pct = (r) => Number(((r.num * 100) / r.den).toFixed(4));
  return {
    asOf: today,
    pf: epf ? {
      employeeRate: pct(epf.employeeRate),
      employerRate: pct(epf.employerRate),
      epsRate: pct(epf.epsRate),
      edliRate: pct(epf.edliRate),
      adminRate: pct(epf.adminRate),
      wageCeiling: toRupees(epf.wageCeiling),
      source: epf.source,
      status: epf.status,
    } : null,
    esi: esi ? {
      employeeRate: pct(esi.employeeRate),
      employerRate: pct(esi.employerRate),
      coverageCeiling: toRupees(esi.coverageCeiling),
      pwdCoverageCeiling: toRupees(esi.pwdCoverageCeiling),
      exemptDailyWage: toRupees(esi.employeeExemptDailyWage),
      source: esi.source,
      status: esi.status,
    } : null,
    standard: companyRules.STANDARD,
    components: SALARY_PARTS.map((p) => ({ code: p.code, name: p.name })),
  };
};

/**
 * A yearly CTC split into a monthly salary by the company's template: Basic
 * its % of the CTC, HRA and DA the company's % of Basic (Settings → Payroll →
 * Salary structure), and Special Allowance whatever makes the payslip's CTC —
 * as the company counts it (employer PF/ESI, gratuity, bonus) — come to the
 * CTC. Employer ESI stops above its limit, so the CTC doesn't rise evenly
 * with pay: the largest Special Allowance that doesn't go over is used, and
 * any rupees left over are reported. Read-only.
 */
const splitCtc = async (companyId, { annualCtc, basicPercent } = {}) => {
  const ctcYear = Number(annualCtc);
  if (!Number.isFinite(ctcYear) || ctcYear < 12 || ctcYear > 12_00_00_000) throw new BadRequestError('Enter the yearly CTC (₹12 to ₹12 crore)');
  const ctx = await loadPayrollContext(companyId);
  const calc = companyRules.resolveCompanyCalc(ctx.calc);
  const pct = basicPercent == null || basicPercent === '' ? calc.ctcTemplate.basicPercent : Number(basicPercent);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new BadRequestError('Basic must be between 0% and 100% of the CTC');
  const cfg = ctx.payrollConfig || {};
  // Settings → Payroll → Salary structure: { hra: true, da: true, … }; HRA and DA are on unless switched off.
  const enabled = (key) => {
    const c = cfg.components;
    return !(c && typeof c === 'object' && !Array.isArray(c) && c[key] === false);
  };
  const hraPct = enabled('hra') ? Number(cfg.hra_percent ?? 40) : 0;
  const daPct = enabled('da') ? Number(cfg.da_percent ?? 10) : 0;
  const target = toPaise(ctcYear / 12);
  const basic = Math.round((ctcYear / 12) * (pct / 100));
  const hra = Math.round(basic * (Number.isFinite(hraPct) ? hraPct : 0) / 100);
  const da = Math.round(basic * (Number.isFinite(daPct) ? daPct : 0) / 100);
  const now = moment.tz(TIMEZONE);
  const ctcOf = (special) => {
    const out = computePayslip(ctx, {
      employee: { id: null, gender: null, salary_details: { basic, hra, da, special } },
      summary: {},
      records: [],
      month: now.month() + 1,
      year: now.year(),
    });
    return toPaise(out.breakdown_json.config.ctc_monthly);
  };
  if (ctcOf(0) > target) {
    throw new BadRequestError('At this CTC, Basic, HRA and DA alone cost more than it — lower the Basic % or the HRA/DA %.');
  }
  // The largest whole-rupee Special Allowance whose CTC stays within the target.
  let lo = 0;
  let hi = Math.max(0, Math.ceil(ctcYear / 12));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctcOf(mid) <= target) lo = mid; else hi = mid - 1;
  }
  // A higher amount can fit again above the ESI limit (no employer ESI there).
  for (let s = lo + 1, tries = 0; tries < 2000 && s <= Math.ceil(ctcYear / 12); s += 1, tries += 1) {
    if (ctcOf(s) <= target) lo = s;
  }
  const special = lo;
  const monthlyCtc = ctcOf(special);
  return {
    annualCtc: ctcYear,
    basicPercent: pct,
    monthly: { basic, hra, da, special },
    monthlyGross: basic + hra + da + special,
    monthlyCtc: toRupees(monthlyCtc),
    leftOver: toRupees(target - monthlyCtc),
  };
};

// ── Pay simulator ───────────────────────────────────────────────────────────

/**
 * A sample monthly gross split the way the company structures salaries
 * (Settings → Payroll → Salary structure): Basic its % of the pay
 * (Calculation → CTC template; 50% standard), HRA and DA their % of Basic —
 * each only when switched on — and Special Allowance the rest. With Special
 * Allowance switched off, Basic takes the rest (HRA and DA still its %).
 */
const sampleSalary = (ctx, gross) => {
  const cfg = ctx.payrollConfig || {};
  const comps = cfg.components && typeof cfg.components === 'object' && !Array.isArray(cfg.components) ? cfg.components : {};
  // HRA, DA and Special Allowance are on unless switched off (as on the salary form).
  const on = (key) => comps[key] !== false;
  const share = (v, standard) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(100, n) / 100 : standard;
  };
  const h = on('hra') ? share(cfg.hra_percent, 0.4) : 0;
  const d = on('da') ? share(cfg.da_percent, 0.1) : 0;
  const total = Math.round(gross);
  if (!on('special')) {
    const base = Math.round(total / (1 + h + d));
    const hra = Math.round(base * h);
    const da = Math.round(base * d);
    return { basic: total - hra - da, hra, da, special: 0 };
  }
  const basic = Math.round(total * (companyRules.resolveCompanyCalc(ctx.calc).ctcTemplate.basicPercent / 100));
  const hra = Math.min(Math.round(basic * h), total - basic);
  const da = Math.min(Math.round(basic * d), total - basic - hra);
  return {
    basic, hra, da, special: total - basic - hra - da,
  };
};

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
  const numOverride = (v, max) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.min(max, Math.max(0, Number(v))));
  // The company's own choices on screen.
  if (o.calc && typeof o.calc === 'object') ctx.calc = companyRules.normalizeCompanyCalc(o.calc);
  if (PF_POLICIES.includes(o.pfPolicy)) ctx.pfPolicy = o.pfPolicy;
  if (typeof o.esiApplicable === 'boolean') ctx.esiApplicable = o.esiApplicable;
  if (TDS_POLICIES.includes(o.tdsPolicy)) ctx.tdsPolicy = o.tdsPolicy;
  if (typeof o.ptState === 'string') {
    ctx.ptState = o.ptState.trim();
    ctx.ptStateUnconfirmed = false;
  }
  if (Array.isArray(o.ptOtherStates)) ctx.ptOtherStates = normalizeOtherStatePt(o.ptOtherStates);
  if (Array.isArray(o.lwfStates)) ctx.lwfStates = normalizeLwfStates(o.lwfStates);
  if (o.ptManualSlabs === null) ctx.ptManualSlabs = null;
  else if (Array.isArray(o.ptManualSlabs)) ctx.ptManualSlabs = normalizePtSlabs(o.ptManualSlabs);
  if (o.ptManualAmount === null || o.ptManualAmount === '') ctx.ptManualAmount = null;
  else if (o.ptManualAmount !== undefined) {
    const amount = numOverride(o.ptManualAmount, 100000);
    if (amount !== undefined) ctx.ptManualAmount = toPaise(amount);
  }
  // The salary structure on screen (components on/off, HRA and DA as % of Basic), saved or not.
  if (o.components && typeof o.components === 'object' && !Array.isArray(o.components)) {
    ctx.payrollConfig = { ...ctx.payrollConfig, components: o.components };
  }
  const hraPct = numOverride(o.hraPercent, 100);
  if (hraPct !== undefined) ctx.payrollConfig = { ...ctx.payrollConfig, hra_percent: hraPct };
  const daPct = numOverride(o.daPercent, 100);
  if (daPct !== undefined) ctx.payrollConfig = { ...ctx.payrollConfig, da_percent: daPct };
  const fixedDays = numOverride(o.workingDaysSetting, 31);
  if (fixedDays) ctx.workingDaysSetting = Math.max(1, Math.round(fixedDays));
  if (Array.isArray(o.customOptions)) {
    ctx.payrollConfig = {
      ...ctx.payrollConfig,
      custom_payroll_options: o.customOptions.slice(0, 50).map((c) => ({
        id: c.id, name: String(c.name || '').slice(0, 80), kind: c.kind, value_type: c.valueType || c.value_type,
        value: Number(c.value) || 0, base: c.base, active: c.active !== false,
      })),
    };
  }

  // Whose pay: a real employee (their salary and setup), the salary typed on
  // the Add/Edit Employee form (not saved yet), or a sample salary.
  let employee;
  if (body.employeeId) {
    employee = await loadEmployeeForPayroll(body.employeeId);
  } else if (body.salary && typeof body.salary === 'object') {
    const s = body.salary;
    const amount = (v) => round2(simNum(v, 100000000));
    employee = {
      id: null,
      gender: ['male', 'female', 'other'].includes(body.gender) ? body.gender : null,
      salary_details: {
        basic: amount(s.basic),
        hra: amount(s.hra),
        da: amount(s.da),
        special: amount(s.special),
        transport: amount(s.transport),
        medical: amount(s.medical),
        pf_applicable: s.pf_applicable !== false,
        pt_applicable: s.pt_applicable !== false,
        esi_set: typeof s.esi_applicable === 'boolean',
        esi_applicable: s.esi_applicable !== false,
        tds_mode: ['company', 'fixed', 'none'].includes(s.tds_mode) ? s.tds_mode : 'company',
        tds_fixed: amount(s.tds_fixed),
        vpf_percent: simNum(s.vpf_percent, 100),
      },
    };
  } else {
    // A sample: the pay split the way the company structures salaries.
    const gross = simNum(body.gross ?? 30000, 10000000);
    employee = { id: null, gender: null, salary_details: sampleSalary(ctx, gross) };
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
  // A real employee's TDS counts their payslips so far this tax year (drafts included).
  const history = ctx.tdsPolicy === 'projected' && employee.id
    ? { tax: await loadTaxYearHistory(employee, month, year, { countDrafts: true }) }
    : null;
  const result = computePayslip(ctx, {
    employee, summary, records, month, year, leaveAvailable, history,
  });
  const cfg = result.breakdown_json.config;
  return {
    ...result,
    month,
    year,
    workingDays,
    sample: !body.employeeId && !body.salary,
    blockers: cfg.blockers || [],
    warnings: cfg.warnings || [],
  };
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

/**
 * The expense claims a month's payslip pays (defect D10): every approved claim
 * not yet paid, with an expense date up to the month's end — so a claim
 * approved after its own month's payslip is paid with the next one instead of
 * never. A claim on any published payslip is never paid again, whatever its
 * status says. Publishing marks the claims paid (applyPublishEffects).
 */
const fetchMonthReimbursements = async (employeeId, month, year) => {
  if (!employeeId || !month || !year) return [];
  const end = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const [{ data, error }, { data: published, error: pubErr }] = await Promise.all([
    supabaseAdmin
      .from('reimbursements')
      .select('id, reimbursement_type, amount, description, expense_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('expense_date', end)
      .order('expense_date', { ascending: true }),
    supabaseAdmin
      .from('payroll')
      .select('id, payslip_status, breakdown_json')
      .eq('employee_id', employeeId)
      .eq('payslip_status', PAYSLIP_STATUS.PUBLISHED),
  ]);
  if (error) throw new BadRequestError(error.message);
  if (pubErr) throw new BadRequestError(pubErr.message);
  const alreadyPaid = new Set();
  for (const r of published || []) {
    if (String(r.payslip_status || '').toUpperCase() !== PAYSLIP_STATUS.PUBLISHED) continue;
    for (const c of r.breakdown_json?.reimbursements || []) if (c?.id) alreadyPaid.add(String(c.id));
  }
  return (data || [])
    .filter((r) => String(r.status) === 'approved' && String(r.expense_date || '').slice(0, 10) <= end && !alreadyPaid.has(String(r.id)))
    .map((r) => ({
      id: r.id,
      name: r.description
        || String(r.reimbursement_type || 'Reimbursement').replace(/_/g, ' '),
      amount: round2(Number(r.amount || 0)),
      expense_date: String(r.expense_date || '').slice(0, 10) || null,
    }));
};

const enrichPayslipBreakdown = async (employee, calc, month, year) => {
  const salary = employee?.salary_details || {};
  const bank = employee?.bank_details || {};
  const cfg = calc.breakdown_json?.config || {};
  // Cost to company: what HR recorded, else a year of the full monthly pay
  // plus the employer's PF, EDLI, admin and ESI on it (defect D15: it used
  // to be gross × 12, without any employer contribution).
  const ctc = round2(Number(salary.ctc || salary.annual_ctc || salary.annualCtc || 0)
    || Number(cfg.ctc_monthly || 0) * 12);
  const working = Number(cfg.working_days || 0);
  const lop = Number(calc.unpaid_leave_days ?? cfg.unpaid_leave_days ?? 0);
  const paidDays = cfg.paid_days != null ? Number(cfg.paid_days) : round2(Math.max(0, working - lop));
  const reimbursements = await fetchMonthReimbursements(employee.id, month, year);
  const totalReimb = round2(reimbursements.reduce((s, r) => s + Number(r.amount || 0), 0));
  const account = bank.account_number || bank.accountNumber || bank.account || '';
  const netPay = Number(calc.breakdown_json?.totals?.net_pay ?? calc.net_salary ?? 0);
  // Net pay plus reimbursements, to the nearest rupee (the difference is shown).
  const payablePaise = toPaise(netPay) + toPaise(totalReimb);
  const netPayable = toRupees(roundRupees(payablePaise));

  calc.breakdown_json = {
    ...calc.breakdown_json,
    reimbursements,
    totals: {
      ...(calc.breakdown_json?.totals || {}),
      total_reimbursements: totalReimb,
      net_payable: netPayable,
      rounding_adjustment: round2(netPayable - toRupees(payablePaise)),
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
  paid_on: row.paid_on ?? null,
  payment_reference: row.payment_reference ?? null,
  published_at: row.published_at ?? null,
  // Approved, and the figures are still the ones approved (maker-checker).
  approved_by: row.approved_by ?? null,
  approved_at: row.approved_at ?? null,
  approval_current: Boolean(row.approved_figures) && row.approved_figures === approvalFingerprint(row),
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

/** Every employee row of a company (active or not), a page at a time. */
const loadCompanyEmployees = async (companyId) => {
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('*')
      .eq('company_id', companyId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new BadRequestError(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) return all;
  }
};

const loadPayrollMonth = async (payrollMonthId, companyId) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .maybeSingle();
  // A client-supplied payroll_month_id must belong to the caller's own
  // company — otherwise an HR/Admin who knows/guesses another tenant's
  // payroll_months UUID could attach their own employee's payslip to it.
  if (!payrollMonth || (companyId && payrollMonth.company_id !== companyId)) {
    throw new NotFoundError('Payroll month not found');
  }
  return payrollMonth;
};

/**
 * Work out one employee's draft for the month and save it (a new draft, or
 * the existing draft recalculated). Refuses:
 *  - a month that isn't over yet (attendance counts the full month);
 *  - someone not employed during the month;
 *  - a published payslip (published means final — defect D1);
 *  - a slip the calculation marked wrong (breakdown config.blockers).
 * A completed month opens again only once a draft is really written (D18:
 * it used to reopen even when generating was refused).
 */
const generateDraftPayslip = async (payrollMonthId, userId, companyId = null, opts = {}) => {
  const payrollMonth = opts.payrollMonth || await loadPayrollMonth(payrollMonthId, companyId);
  const { month, year } = payrollMonth;

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  const { getCompanyId } = require('../utils/tenant');
  if (!employee || String(getCompanyId(employee)) !== String(payrollMonth.company_id)) {
    throw new NotFoundError('Employee not found');
  }
  const employment = employmentInMonth(employee, month, year);
  // The month after a leaver's last: a settlement payslip, only for one-time pay added to it.
  const settlement = !employment.employed && isSettlementMonth(employee, month, year)
    && (await require('./oneTimePay.service').itemsDue(employee.id, month, year)).length > 0;
  if (!employment.employed && !settlement) throw new BadRequestError(employment.reason);
  // The month must be over — or, for someone who left in it, their last working day.
  if (!monthHasEnded(month, year) && !leaverFinalMonthReady(employment.lastWorkingDay, month, year) && !settlement) {
    throw new BadRequestError(monthNotOverMessage(month, year));
  }

  const { data: existing } = await supabaseAdmin
    .from('payroll')
    .select('id, payslip_status')
    .eq('employee_id', userId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle();
  if (existing?.id && String(existing.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.PUBLISHED) {
    throw new ConflictError('Payslip already published for this employee and month');
  }

  const { summary, records } = await attendanceService.getMonthlySummary(userId, month, year, {
    lastWorkingDay: settlement ? lastWorkingDayOf(employee) : employment.lastWorkingDay,
  });
  const calc = await enrichPayslipBreakdown(
    employee,
    await calculateContractPayslip(employee, summary, month, {
      year, records, ctx: opts.ctx, withHistory: true,
    }),
    month,
    year,
  );
  const blockers = calc.breakdown_json?.config?.blockers || [];
  if (blockers.length) throw new BadRequestError(blockers.map((b) => b.message).join(' '));

  let saved;
  if (existing?.id) {
    const { data, error } = await supabaseAdmin
      .from('payroll')
      .update({
        ...calc,
        payslip_status: PAYSLIP_STATUS.DRAFT,
        payment_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('payslip_status', PAYSLIP_STATUS.DRAFT) // never overwrite one published meanwhile
      .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
      .maybeSingle();
    if (error) throw new BadRequestError(error.message);
    if (!data) throw new ConflictError('Payslip already published for this employee and month');
    saved = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('payroll')
      .insert({
        employee_id: userId,
        payroll_month_id: payrollMonth.id,
        company_id: payrollMonth.company_id,
        month,
        year,
        ...calc,
        payslip_status: PAYSLIP_STATUS.DRAFT,
        payment_status: 'pending',
      })
      .select('*, employee:employee_id(id, first_name, last_name, employee_code, email, company_id, address)')
      .single();
    if (error) throw new BadRequestError(error.message);
    saved = data;
  }

  if (payrollMonth.status === MONTH_STATUS.COMPLETED) {
    await supabaseAdmin
      .from('payroll_months')
      .update({ status: MONTH_STATUS.PENDING })
      .eq('id', payrollMonth.id)
      .eq('status', MONTH_STATUS.COMPLETED);
    payrollMonth.status = MONTH_STATUS.PENDING;
  }
  return mapPayslipRow(saved);
};

/** Drafts for everyone employed during the month — active staff and anyone who left during it. */
const generateAllDraftPayslips = async (payrollMonthId, companyId = null) => {
  // No caller in this codebase ever legitimately omits companyId for a
  // payroll operation — fail closed instead of silently generating payslips
  // for every active employee on the entire platform.
  if (!companyId) throw new BadRequestError('companyId is required to generate payslips');
  const payrollMonth = await loadPayrollMonth(payrollMonthId, companyId);
  if (!monthHasEnded(payrollMonth.month, payrollMonth.year)) {
    throw new BadRequestError(monthNotOverMessage(payrollMonth.month, payrollMonth.year));
  }

  const employees = await loadCompanyEmployees(companyId);
  const results = [];
  const ctx = await loadPayrollContext(companyId);
  for (const emp of employees) {
    // People who weren't employed at all this month are simply not part of it.
    if (!employmentInMonth(emp, payrollMonth.month, payrollMonth.year).employed) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const payslip = await generateDraftPayslip(payrollMonth.id, emp.id, companyId, { ctx, payrollMonth });
      results.push({ user_id: emp.id, status: 'generated', payslip });
    } catch (err) {
      results.push({ user_id: emp.id, status: 'skipped', reason: err.message });
    }
  }
  return results;
};

const generatePayslipPdf = (employee, payslip, payrollMonth, companyId) =>
  buildPayslipPdfBuffer(employee, payslip, payrollMonth, { companyId });

/**
 * A month is complete once everyone employed during it has a published
 * payslip and no draft is left. (It used to compare a count of published
 * slips with today's active headcount, which leavers and joiners skewed.)
 */
const maybeCloseMonth = async (payrollMonthId) => {
  const { data: payrollMonth } = await supabaseAdmin
    .from('payroll_months')
    .select('*')
    .eq('id', payrollMonthId)
    .maybeSingle();
  if (!payrollMonth) return;

  const { data: slips, error } = await supabaseAdmin
    .from('payroll')
    .select('employee_id, payslip_status')
    .eq('payroll_month_id', payrollMonthId);
  if (error || !(slips || []).length) return;
  if (slips.some((s) => String(s.payslip_status || '').toUpperCase() !== PAYSLIP_STATUS.PUBLISHED)) return;

  const published = new Set(slips.map((s) => String(s.employee_id)));
  const employees = await loadCompanyEmployees(payrollMonth.company_id);
  const due = employees.filter((e) => employmentInMonth(e, payrollMonth.month, payrollMonth.year).employed);
  if (due.every((e) => published.has(String(e.id)))) {
    await supabaseAdmin
      .from('payroll_months')
      .update({ status: MONTH_STATUS.COMPLETED })
      .eq('id', payrollMonthId);
  }
};

/**
 * What to sort out before generating a month's payslips — read-only.
 *   block  payroll can't run: the month isn't over, or PT isn't set up
 *   warn   requests still pending in the month (a pending leave or WFH day
 *          counts as an absence until it is approved), people with no
 *          salary or no bank details, choices left at their defaults
 */
const getPayrollChecks = async (month, year, companyId) => {
  const m = Number(month);
  const y = Number(year);
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) throw new BadRequestError('month and year are required');
  if (!companyId) throw new BadRequestError('companyId is required');
  const start = ymd(y, m, 1);
  const end = moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE).endOf('month').format('YYYY-MM-DD');
  const label = moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE).format('MMMM YYYY');
  const ctx = await loadPayrollContext(companyId);
  const employees = (await loadCompanyEmployees(companyId))
    .filter((e) => employmentInMonth(e, m, y).employed);
  const ids = employees.map((e) => e.id);
  const nameOf = new Map(employees.map((e) => [String(e.id), `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.employee_code || 'Employee']));
  const people = (list) => list.slice(0, 25).map((id) => ({ id, name: nameOf.get(String(id)) || 'Employee' }));
  const items = [];

  const monthEnded = monthHasEnded(m, y);
  if (!monthEnded) items.push({ key: 'month_open', level: 'block', title: monthNotOverMessage(m, y) });

  const pt = statutory.ptRule(ctx.ptState, end);
  if (ctx.ptStateUnconfirmed) {
    items.push({ key: 'pt_state_confirm', level: 'block', title: 'Confirm the company\'s Professional Tax state in Settings → Payroll — the earlier settings screen filled in Karnataka by itself, so it may not be a real choice.' });
  }
  if (pt.kind === 'unknown' && ctx.ptManualAmount == null) {
    items.push({ key: 'pt_state', level: 'block', title: 'Choose the company\'s Professional Tax state in Settings → Payroll.' });
  } else if (['manual', 'verify', 'missing'].includes(pt.kind) && ctx.ptManualAmount == null && !ctx.ptManualSlabs) {
    items.push({ key: 'pt_amount', level: 'block', title: `Enter the monthly Professional Tax for ${pt.state?.name || ctx.ptState} (or choose "No PT") in Settings → Payroll — SpaxSync has no PT table for it yet.` });
  }
  // Staff who work in another state with no SpaxSync PT table and no slabs entered for it.
  const ownStateName = statutory.findState(ctx.ptState)?.name || ctx.ptState;
  const ptStateGaps = employees.filter((e) => {
    const s = resolvePayrollSetup(e.salary_details);
    if (!s.pt || !s.ptState || s.ptState === ownStateName) return false;
    return ['manual', 'verify', 'missing'].includes(statutory.ptRule(s.ptState, end).kind) && !(ctx.ptOtherStates || {})[s.ptState];
  }).map((e) => e.id);
  if (ptStateGaps.length) {
    items.push({ key: 'pt_other_state', level: 'warn', title: `${ptStateGaps.length} ${ptStateGaps.length === 1 ? 'person works' : 'people work'} in a state SpaxSync has no Professional Tax table for, and no slabs are entered for it — add them in Settings → Payroll → Deductions, or their payslip won't generate.`, people: people(ptStateGaps) });
  }

  if (ids.length) {
    // A batch of people at a time (a long IN list can pass the URL length limit).
    const [leaves, wfh, tickets] = await Promise.all([
      selectIn(supabaseAdmin, 'leaves', 'employee_id', 'employee_id', ids, {
        filter: (q) => q.eq('status', 'pending').lte('from_date', end).gte('to_date', start),
      }),
      selectIn(supabaseAdmin, 'wfh_day_requests', 'employee_id', 'employee_id', ids, {
        filter: (q) => q.eq('status', 'pending').gte('work_date', start).lte('work_date', end),
      }),
      selectIn(supabaseAdmin, 'helpdesk_tickets', 'raised_by, subject, status', 'raised_by', ids, {
        filter: (q) => q.eq('category', 'hr').in('status', ['open', 'in_progress'])
          .ilike('subject', `Attendance correction — ${y}-${String(m).padStart(2, '0')}%`),
      }),
    ]);
    for (const r of [leaves, wfh, tickets]) if (r.error) throw new BadRequestError(r.error.message);
    const distinct = (rows, key) => [...new Set((rows || []).map((r) => String(r[key])))];
    const pendingLeave = distinct(leaves.data, 'employee_id');
    if (pendingLeave.length) {
      items.push({ key: 'pending_leave', level: 'warn', title: `${pendingLeave.length} ${pendingLeave.length === 1 ? 'person has' : 'people have'} leave pending in ${label}. Until it is approved, those days count as absences.`, people: people(pendingLeave) });
    }
    const pendingWfh = distinct(wfh.data, 'employee_id');
    if (pendingWfh.length) {
      items.push({ key: 'pending_wfh', level: 'warn', title: `${pendingWfh.length} ${pendingWfh.length === 1 ? 'person has' : 'people have'} work-from-home days pending in ${label}. Until approved, those days count as absences.`, people: people(pendingWfh) });
    }
    const openCorrections = distinct(tickets.data, 'raised_by');
    if (openCorrections.length) {
      items.push({ key: 'open_corrections', level: 'warn', title: `${openCorrections.length} ${openCorrections.length === 1 ? 'person has' : 'people have'} attendance corrections for ${label} still open.`, people: people(openCorrections) });
    }
  }

  const monthlyGross = (e) => SALARY_PARTS.reduce((s, p) => s + (salaryAmount(e.salary_details?.[p.field]) || 0), 0);
  const badSalary = employees.filter((e) => SALARY_PARTS.some((p) => salaryAmount(e.salary_details?.[p.field]) === null)).map((e) => e.id);
  if (badSalary.length) {
    items.push({ key: 'salary_not_a_number', level: 'warn', title: `${badSalary.length} ${badSalary.length === 1 ? 'person has' : 'people have'} a salary part that isn't a valid amount — their payslip won't generate until it's fixed in Edit Employee.`, people: people(badSalary) });
  }
  const noSalary = employees.filter((e) => !badSalary.includes(e.id) && !(monthlyGross(e) > 0)).map((e) => e.id);
  if (noSalary.length) {
    items.push({ key: 'no_salary', level: 'warn', title: `${noSalary.length} ${noSalary.length === 1 ? 'person has' : 'people have'} no salary set — their payslip would be ₹0.`, people: people(noSalary) });
  }
  // A yearly figure typed into the monthly salary would pay twelve times over.
  const LARGE_MONTHLY_GROSS = 500000_00;
  const veryHigh = employees.filter((e) => monthlyGross(e) > LARGE_MONTHLY_GROSS).map((e) => e.id);
  if (veryHigh.length) {
    items.push({ key: 'salary_very_high', level: 'warn', title: `${veryHigh.length} ${veryHigh.length === 1 ? 'person has' : 'people have'} a monthly salary above ₹5,00,000 — check it is the monthly amount, not the yearly one.`, people: people(veryHigh) });
  }
  const noBank = employees.filter((e) => {
    const b = e.bank_details || {};
    return !((b.account_number || b.accountNumber || b.account) && (b.ifsc || b.ifscCode) && (b.bank_name || b.bankName));
  }).map((e) => e.id);
  if (noBank.length) {
    items.push({ key: 'no_bank', level: 'warn', title: `${noBank.length} ${noBank.length === 1 ? 'person has' : 'people have'} no complete bank details — their payslip can't be published.`, people: people(noBank) });
  }
  if (ctx.tdsPolicy === 'projected' && employees.length) {
    const taxYear = taxYearOf(m, y);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const projectedFor = employees.filter((e) => resolvePayrollSetup(e.salary_details).tdsMode === 'company');
    const noPan = projectedFor.filter((e) => !resolvePayrollSetup(e.salary_details).statutoryIds.pan).map((e) => e.id);
    if (noPan.length) {
      items.push({ key: 'tax_no_pan', level: 'warn', title: `${plural(noPan.length, 'person has', 'people have')} no PAN recorded (Employee → Payroll setup). Without a PAN the law can require TDS at a higher rate — check with your CA.`, people: people(noPan) });
    }
    const defaultRegime = companyRules.resolveCompanyCalc(ctx.calc).tds.defaultRegime;
    const oldNoBirthDate = projectedFor.filter((e) => tdsProjection.resolveTaxProfile(e.salary_details, taxYear, defaultRegime).regime === 'old'
      && !e.date_of_birth).map((e) => e.id);
    if (oldNoBirthDate.length) {
      items.push({ key: 'tax_old_regime_no_dob', level: 'warn', title: `${plural(oldNoBirthDate.length, 'person is', 'people are')} on the old tax regime with no date of birth recorded — their TDS uses the slabs for people under 60.`, people: people(oldNoBirthDate) });
    }
    const earlier = taxYearMonthsBefore(m, y);
    if (earlier.length && projectedFor.length) {
      const years = [...new Set(earlier.map((p) => p.year))];
      const { data: rows, error } = await selectIn(supabaseAdmin, 'payroll', 'employee_id, month, year, payslip_status', 'employee_id',
        projectedFor.map((e) => e.id), { filter: (q) => q.in('year', years) });
      if (error) throw new BadRequestError(error.message);
      const slips = (rows || []).filter((r) => earlier.some((p) => p.month === Number(r.month) && p.year === Number(r.year)));
      const withDraft = [...new Set(slips.filter((r) => String(r.payslip_status || '').toUpperCase() !== PAYSLIP_STATUS.PUBLISHED).map((r) => String(r.employee_id)))];
      if (withDraft.length) {
        items.push({ key: 'tax_earlier_draft', level: 'warn', title: `${plural(withDraft.length, 'person has', 'people have')} an earlier payslip this tax year still in draft — publish it first; until then their ${label} payslip can't be generated (its TDS would miss that month).`, people: people(withDraft) });
      }
      const index = (yy, mm) => yy * 12 + mm;
      const gaps = projectedFor.filter((e) => {
        const p = tdsProjection.resolveTaxProfile(e.salary_details, taxYear, defaultRegime);
        if (p.earlier_income > 0 || p.previous_employer_income > 0) return false;
        const joined = e.date_of_joining ? String(e.date_of_joining).slice(0, 7) : null;
        const fromIndex = joined ? index(Number(joined.slice(0, 4)), Number(joined.slice(5, 7))) : 0;
        return earlier.some((p2) => index(p2.year, p2.month) >= fromIndex
          && !slips.some((r) => String(r.employee_id) === String(e.id) && Number(r.month) === p2.month && Number(r.year) === p2.year));
      }).map((e) => e.id);
      if (gaps.length) {
        items.push({ key: 'tax_missing_months', level: 'warn', title: `${plural(gaps.length, 'person has', 'people have')} months this tax year with no SpaxSync payslip and no earlier salary recorded, so their TDS treats those months as unpaid. If they were paid outside SpaxSync, enter that salary and its TDS in their Payroll setup.`, people: people(gaps) });
      }
    }
  }

  const defaults = [];
  if (!ctx.choicesMade.pf) defaults.push(`PF: ${ctx.pfPolicy === 'not_applicable' ? 'not applicable' : 'on Basic + DA up to the legal limit (not the full Basic)'}`);
  if (!ctx.choicesMade.esi) defaults.push(`ESI: ${ctx.esiApplicable ? 'covered' : 'not covered'}`);
  if (defaults.length) {
    items.push({ key: 'defaults', level: 'warn', title: `Not chosen in Settings → Payroll yet, so payroll uses: ${defaults.join('; ')}. Choose them there so pay follows your company's own policy.` });
  }

  return {
    month: m,
    year: y,
    monthEnded,
    employeesInMonth: employees.length,
    canGenerate: !items.some((i) => i.level === 'block'),
    items,
  };
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

  // The expense claims this payslip pays are marked paid (no later payslip pays them again).
  const claimIds = (payslip.breakdown_json?.reimbursements || []).map((r) => r?.id).filter(Boolean);
  if (claimIds.length && !config.reimbursements_paid_at) {
    try {
      const { error } = await supabaseAdmin
        .from('reimbursements')
        .update({ status: 'paid', payment_date: moment.tz(TIMEZONE).format('YYYY-MM-DD') })
        .in('id', claimIds)
        .eq('employee_id', payslip.employee_id)
        .eq('status', 'approved');
      if (error) throw new Error(error.message);
      config.reimbursements_paid_at = nowIso;
    } catch (err) {
      logger.error('Payslip published but its expense claims could not be marked paid', { payslipId: payslip.id, error: err.message });
      config.reimbursements_error = err.message;
    }
  }

  if (Array.isArray(config.loans) && config.loans.length && !config.loans_recorded_at) {
    try {
      await require('./employeeLoan.service').recordRecoveries(
        { id: payslip.id, month: payslip.month, year: payslip.year },
        config.loans.map((l) => ({ loan_id: l.loan_id, amount: l.amount })),
      );
      config.loans_recorded_at = nowIso;
    } catch (err) {
      logger.error('Payslip published but the loan recovery could not be recorded', { payslipId: payslip.id, error: err.message });
      config.loans_error = err.message;
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

/** The figures a published payslip shows: they must match a fresh calculation. */
const PUBLISH_CHECKED_FIELDS = ['gross_salary', 'total_deductions', 'net_salary', 'pf_deduction', 'esi_deduction', 'professional_tax', 'tds'];

/** Recalculate a draft as generating it now would, and refuse it if anything differs or is blocked. */
const assertDraftIsCurrent = async (payslip) => {
  const { data: employee, error } = await supabaseAdmin
    .from('employees').select('*').eq('id', payslip.employee_id).maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!employee) throw new NotFoundError('Employee not found');
  const employment = employmentInMonth(employee, payslip.month, payslip.year);
  // A settlement payslip (the month after leaving) only while it has one-time pay on it.
  const settlement = !employment.employed && isSettlementMonth(employee, payslip.month, payslip.year)
    && (await require('./oneTimePay.service').itemsDue(employee.id, payslip.month, payslip.year)).length > 0;
  if (!employment.employed && !settlement) throw new ConflictError(`This payslip can't be published: ${employment.reason}.`);
  const { summary, records } = await attendanceService.getMonthlySummary(payslip.employee_id, payslip.month, payslip.year, {
    lastWorkingDay: settlement ? lastWorkingDayOf(employee) : employment.lastWorkingDay,
  });
  const fresh = await enrichPayslipBreakdown(
    employee,
    await calculateContractPayslip(employee, summary, payslip.month, { year: payslip.year, records, withHistory: true }),
    payslip.month,
    payslip.year,
  );
  const blockers = fresh.breakdown_json?.config?.blockers || [];
  if (blockers.length) {
    throw new ConflictError(`This payslip can't be published now: ${blockers.map((b) => b.message).join(' ')}`);
  }
  const differs = PUBLISH_CHECKED_FIELDS.filter((f) => toPaise(fresh[f]) !== toPaise(payslip[f]));
  const payable = (row) => toPaise(row.breakdown_json?.totals?.net_payable ?? row.net_salary);
  if (payable(fresh) !== payable(payslip)) differs.push('net_payable');
  if (differs.length) {
    throw new ConflictError('This draft no longer matches the current salary, attendance, leave or settings — generate it again, then publish.');
  }
  return fresh;
};

/**
 * Year to date for a payslip being published: the tax year's published
 * payslips before it (this company) plus this one, in rupees.
 */
const yearToDate = async (payslip, companyId) => {
  const m = Number(payslip.month);
  const y = Number(payslip.year);
  const startYear = m >= 4 ? y : y - 1;
  const { data, error } = await supabaseAdmin
    .from('payroll')
    .select('id, month, year, gross_salary, pf_deduction, esi_deduction, professional_tax, tds, net_salary, payslip_status, company_id')
    .eq('employee_id', payslip.employee_id)
    .in('year', [startYear, startYear + 1]);
  if (error) throw new BadRequestError(error.message);
  const index = (yy, mm) => yy * 12 + mm;
  const earlier = (data || []).filter((r) => String(r.payslip_status || '').toUpperCase() === PAYSLIP_STATUS.PUBLISHED
    && String(r.id) !== String(payslip.id)
    && (!r.company_id || !companyId || String(r.company_id) === String(companyId))
    && index(Number(r.year), Number(r.month)) >= index(startYear, 4)
    && index(Number(r.year), Number(r.month)) < index(y, m));
  const total = (key) => toRupees(earlier.reduce((s, r) => s + toPaise(r[key]), 0) + toPaise(payslip[key]));
  return {
    tax_year: `${startYear}-${String(startYear + 1).slice(2)}`,
    months: earlier.length + 1,
    gross: total('gross_salary'),
    pf: total('pf_deduction'),
    esi: total('esi_deduction'),
    pt: total('professional_tax'),
    tds: total('tds'),
    net: total('net_salary'),
  };
};

/** The figures an approval is for: if any of them changes, the approval no longer holds. */
const approvalFingerprint = (row) => {
  const b = row?.breakdown_json || {};
  const linesOf = (list) => (Array.isArray(list) ? list : []).map((l) => [String(l?.name || ''), toPaise(l?.amount)]);
  return JSON.stringify([
    ...PUBLISH_CHECKED_FIELDS.map((f) => toPaise(row?.[f])),
    toPaise(b.totals?.net_payable ?? row?.net_salary),
    // Every line, and what the company pays on top (ECR, ESI and employer cost follow these).
    linesOf(b.earnings),
    linesOf(b.deductions),
    linesOf(b.employer_contributions),
  ]);
};

const APPROVAL_SQL = '20261104_payroll_approval.sql';
const approvalRequired = async (companyId) => companyRules.resolveCompanyCalc(
  await settingsService.getSetting('payroll_calc', null, companyId),
).approval.required;

/**
 * Approve a draft payslip (maker-checker, when the company asks for it): it
 * must be what the calculation gives today, and the approval is of its exact
 * figures. Whoever approves can't then publish it.
 */
const approvePayslip = async (payslipId, approver, { ipAddress = null } = {}) => {
  const { data: payslip, error } = await supabaseAdmin
    .from('payroll')
    .select(`*, employee:employee_id(${PAYSLIP_EMPLOYEE_SELECT})`)
    .eq('id', payslipId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!payslip || require('../utils/tenant').getCompanyId(payslip.employee) !== approver.company_id) {
    throw new NotFoundError('Payslip not found');
  }
  if (payslip.payslip_status === PAYSLIP_STATUS.PUBLISHED) throw new BadRequestError('Payslip is already published');
  if (String(payslip.employee_id) === String(approver.id)) {
    throw new ForbiddenError('You can\'t approve your own payslip — someone else has to.');
  }
  if (payslip.breakdown_json?.config?.engine !== 2) {
    throw new ConflictError('This draft was worked out by the earlier payroll calculation — generate it again, then approve.');
  }
  if (!('approved_figures' in payslip)) {
    throw new BadRequestError(`Approvals can't be recorded yet — run the SQL file ${APPROVAL_SQL} first.`);
  }
  await assertDraftIsCurrent(payslip);
  const patch = { approved_by: approver.id, approved_at: new Date().toISOString(), approved_figures: approvalFingerprint(payslip) };
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('payroll')
    .update(patch)
    .eq('id', payslipId)
    .eq('payslip_status', PAYSLIP_STATUS.DRAFT)
    .select('id')
    .maybeSingle();
  if (updErr) throw new BadRequestError(updErr.message);
  if (!updated) throw new ConflictError('Payslip is already published');
  require('./auditLog.service').logAudit({
    companyId: approver.company_id,
    actorId: approver.id,
    actorRole: approver.role || null,
    actionType: 'payroll.payslip.approve',
    targetType: 'payroll',
    targetId: payslipId,
    afterState: { month: payslip.month, year: payslip.year, net_salary: payslip.net_salary },
    ipAddress,
  }).catch(() => {});
  return { id: payslipId, approvedAt: patch.approved_at };
};

/** Approve every draft of a month that can be approved; the rest are listed with the reason. */
const approveMonth = async (month, year, approver, opts = {}) => {
  const m = Number(month);
  const y = Number(year);
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) throw new BadRequestError('month and year are required');
  const ids = await require('./tenant.service').getCompanyEmployeeIds(approver.company_id);
  const { data: rows, error } = await selectIn(supabaseAdmin, 'payroll', 'id, employee_id, payslip_status', 'employee_id', ids, {
    filter: (q) => q.eq('month', m).eq('year', y).eq('payslip_status', PAYSLIP_STATUS.DRAFT),
  });
  if (error) throw new BadRequestError(error.message);
  let approved = 0;
  const skipped = [];
  for (const r of rows || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await approvePayslip(r.id, approver, opts);
      approved += 1;
    } catch (err) {
      skipped.push({ payslipId: r.id, employeeId: r.employee_id, reason: err.message });
      if (/run the SQL file/.test(err.message || '')) break;
    }
  }
  return { approved, skipped };
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
  // A published payslip can never change, so only one worked out by the
  // current calculation (engine 2), for a month that is over, may become final.
  if (payslip.breakdown_json?.config?.engine !== 2) {
    throw new ConflictError('This draft was worked out by the earlier payroll calculation — generate it again, then publish.');
  }
  // The month must be over — or, for a leaver's final payslip, their last working
  // day; a settlement payslip (the month after it) can be published straight away.
  const leftOnBefore = payslip.breakdown_json?.config?.left_on;
  const settlementSlip = /^\d{4}-\d{2}/.test(String(leftOnBefore || ''))
    && Number(String(leftOnBefore).slice(0, 4)) * 12 + Number(String(leftOnBefore).slice(5, 7)) + 1 === payslip.year * 12 + payslip.month;
  if (!monthHasEnded(payslip.month, payslip.year) && !settlementSlip
    && !leaverFinalMonthReady(payslip.breakdown_json?.config?.left_on, payslip.month, payslip.year)) {
    throw new BadRequestError(monthNotOverMessage(payslip.month, payslip.year));
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

  // Published means final, so the draft must still be what the calculation
  // gives today — salary, attendance, leave, settings and the tax year so far.
  // A draft left behind (a recalculation that was refused, data changed since)
  // is refused: generate it again, then publish.
  // The amounts are the draft's; every detail (leave covered, comp-off, the
  // PF split, …) is today's calculation, which is what gets published.
  const fresh = await assertDraftIsCurrent(payslip);
  // Approval before publishing (Settings → Payroll → Calculation): a second
  // person approved these exact figures, and isn't the one publishing.
  if (await approvalRequired(publisher.company_id)) {
    if (!('approved_figures' in payslip)) {
      throw new ConflictError(`Approval before publishing is on, but approvals can't be recorded yet — run the SQL file ${APPROVAL_SQL} first.`);
    }
    if (!payslip.approved_by) throw new ConflictError('This payslip needs to be approved before it is published.');
    // Both the draft and what would be published now must be what was approved.
    if (payslip.approved_figures !== approvalFingerprint(payslip) || payslip.approved_figures !== approvalFingerprint(fresh)) {
      throw new ConflictError('This payslip changed after it was approved — approve it again, then publish.');
    }
    if (String(payslip.approved_by) === String(publisher.id)) {
      throw new ForbiddenError('You approved this payslip, so someone else has to publish it (approval before publishing needs two people).');
    }
  }
  Object.assign(payslip, fresh);
  // Saved with the published payslip: the tax year so far, and the statutory
  // numbers as they are today (a later change to them doesn't rewrite it).
  {
    const ids = resolvePayrollSetup(payslip.employee?.salary_details).statutoryIds;
    fresh.breakdown_json = {
      ...fresh.breakdown_json,
      meta: {
        ...(fresh.breakdown_json?.meta || {}),
        ytd: await yearToDate(payslip, publisher.company_id),
        ids: { pan: ids.pan || null, uan: ids.uan || null, esic_ip: ids.esicIp || null },
      },
    };
    payslip.breakdown_json = fresh.breakdown_json;
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
    ...fresh,
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
  // The leave balance after this payslip (any casual leave it used counted),
  // as My Leave shows it — saved with the payslip and printed on it.
  let leaveBalance = null;
  try {
    const { getCompanyId } = require('../utils/tenant');
    const balances = await require('./leave.service').getLeaveBalance(
      payslip.employee_id, payslip.year, getCompanyId(payslip.employee) || publisher.company_id,
    );
    leaveBalance = (balances || []).map((b) => ({ code: b.leave_type, name: b.name || b.leave_type, available: round2(b.available) }));
  } catch (err) {
    logger.warn('Payslip published; its leave balance could not be read', { payslipId, error: err.message });
  }
  {
    const meta = { ...(payslip.breakdown_json?.meta || {}), ...(leaveBalance ? { leave: leaveBalance } : {}) };
    const { error: cfgErr } = await supabaseAdmin
      .from('payroll')
      .update({ breakdown_json: { ...(payslip.breakdown_json || {}), config: appliedConfig, meta } })
      .eq('id', payslipId);
    if (cfgErr) logger.error('Could not record what publishing applied', { payslipId, error: cfgErr.message });
  }

  // A month published after later ones (a joiner added late, say): their
  // year-to-date totals now count it too (only that running total changes).
  try {
    const startYear = payslip.month >= 4 ? payslip.year : payslip.year - 1;
    const index = (yy, mm) => yy * 12 + mm;
    const { data: later } = await supabaseAdmin
      .from('payroll')
      .select('id, employee_id, month, year, gross_salary, pf_deduction, esi_deduction, professional_tax, tds, net_salary, payslip_status, company_id, breakdown_json')
      .eq('employee_id', payslip.employee_id)
      .eq('payslip_status', PAYSLIP_STATUS.PUBLISHED)
      .in('year', [startYear, startYear + 1]);
    for (const r of (later || []).filter((x) => String(x.id) !== String(payslipId)
      && index(Number(x.year), Number(x.month)) > index(payslip.year, payslip.month)
      && index(Number(x.year), Number(x.month)) <= index(startYear + 1, 3)
      && x.breakdown_json?.meta?.ytd)) {
      // eslint-disable-next-line no-await-in-loop
      const ytd = await yearToDate(r, publisher.company_id);
      // eslint-disable-next-line no-await-in-loop
      await supabaseAdmin.from('payroll').update({
        breakdown_json: { ...r.breakdown_json, meta: { ...(r.breakdown_json.meta || {}), ytd } },
      }).eq('id', r.id).eq('payslip_status', PAYSLIP_STATUS.PUBLISHED);
    }
  } catch (err) {
    logger.warn('Later payslips\' year to date could not be brought up to date', { payslipId, error: err.message });
  }

  await maybeCloseMonth(payslip.payroll_month_id);
  logger.info('Payslip published', { payslipId, publisherId: publisher.id });

  // TDS by projection counts published payslips, so this employee's later
  // drafts are worked out again now that this month is final (drafts only;
  // nothing is sent).
  if (payslip.breakdown_json?.config?.tds_policy === 'projected') {
    const { runInBackground } = require('../utils/background');
    runInBackground('later drafts after a publish', () => recalculatePayslipsFromSettings({
      employeeId: payslip.employee_id, companyId: publisher.company_id,
    }));
  }

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
 * Re-apply the live payroll settings to DRAFT payslips — the current month
 * and any month still open. A published payslip is final and is never
 * recalculated (defect D1: settings saves and employee edits used to rewrite
 * slips already published and emailed). `draftsOnly` is kept for callers
 * that pass it; it no longer changes anything.
 * A draft the calculation now marks wrong (e.g. PT not set up) is left as it
 * was and reported, rather than overwritten with wrong numbers.
 */
const recalculatePayslipsFromSettings = async ({
  month, year, employeeId, companyId,
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
      .select('*')
      .eq('month', t.month)
      .eq('year', t.year)
      .eq('payslip_status', PAYSLIP_STATUS.DRAFT);
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
        // The whole employee row: leaving dates may be in columns a fixed
        // select list wouldn't have before their migration.
        const { data: employee } = await supabaseAdmin
          .from('employees')
          .select('*')
          .eq('id', row.employee_id)
          .maybeSingle();
        if (!employee) {
          details.push({ id: row.id, status: 'skipped', reason: 'Employee missing' });
          return;
        }
        const employment = employmentInMonth(employee, row.month, row.year);
        // Not employed that month: only a settlement payslip (the month after leaving) is worked out.
        if (!employment.employed && !isSettlementMonth(employee, row.month, row.year)) {
          details.push({ id: row.id, employee_id: row.employee_id, status: 'skipped', reason: employment.reason });
          return;
        }
        const { summary, records } = await attendanceService.getMonthlySummary(
          row.employee_id,
          row.month,
          row.year,
          { lastWorkingDay: employment.employed ? employment.lastWorkingDay : lastWorkingDayOf(employee) },
        );
        const { getCompanyId: companyOf } = require('../utils/tenant');
        const cid = companyOf(employee);
        if (!ctxByCompany.has(cid)) ctxByCompany.set(cid, loadPayrollContext(cid));
        const calc = await enrichPayslipBreakdown(
          employee,
          await calculateContractPayslip(employee, summary, row.month, {
            year: row.year,
            records,
            ctx: await ctxByCompany.get(cid),
            withHistory: true,
          }),
          row.month,
          row.year,
        );
        const blockers = calc.breakdown_json?.config?.blockers || [];
        if (blockers.length) {
          details.push({ id: row.id, employee_id: row.employee_id, status: 'blocked', reason: blockers.map((b) => b.message).join(' ') });
          return;
        }

        // Numbers only here — downloadPayslip always rebuilds PDF from the stored row.
        const { data: written, error: updErr } = await supabaseAdmin
          .from('payroll')
          .update({ ...calc, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('payslip_status', PAYSLIP_STATUS.DRAFT) // published meanwhile → leave it
          .select('id')
          .maybeSingle();

        if (updErr) throw new BadRequestError(updErr.message);
        if (!written) {
          details.push({ id: row.id, status: 'skipped', reason: 'Published meanwhile' });
          return;
        }

        updated += 1;
        details.push({
          id: row.id,
          employee_id: row.employee_id,
          month: row.month,
          year: row.year,
          status: 'updated_draft',
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

/** The day of the month auto-run creates last month's drafts: 1–10 (wages are due before the 7th). */
const autoRunDay = (payrollConfig) => Math.min(
  10,
  Math.max(1, Math.round(Number(payrollConfig?.run_date ?? payrollConfig?.runDate ?? 1)) || 1),
);

/**
 * Auto-process for one company: on its run day, create the drafts for the
 * month that has just ended (attendance counts the full month, so a month
 * is never run before it is over). Drafts only — publishing stays with HR.
 * Once per month: the last month run is kept in its own setting,
 * payroll_auto_run_state, so saving Settings → Payroll (which replaces
 * payroll_config whole) can't erase it and make the hourly catch-up run again.
 */
const autoRunPayrollForCompany = async (companyId, { force = false } = {}) => {
  const settingsService = require('./settings.service');
  const tenantService = require('./tenant.service');

  const now = moment.tz(TIMEZONE);
  const target = now.clone().subtract(1, 'month');
  const month = target.month() + 1;
  const year = target.year();
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const payrollConfig = (await settingsService.getSetting('payroll_config', {}, companyId)) || {};
  const autoProcess = Boolean(
    payrollConfig.auto_process ?? payrollConfig.autoProcess ?? false,
  );
  if (!autoProcess && !force) {
    return { companyId, skipped: true, reason: 'auto_process_off' };
  }

  const runDay = autoRunDay(payrollConfig);
  if (!force && now.date() !== runDay) {
    return { companyId, skipped: true, reason: 'not_run_date', runDay, today: now.date() };
  }

  const state = (await settingsService.getSetting('payroll_auto_run_state', null, companyId)) || {};
  // Only this run's own record: the old last_auto_payroll_ym was the month the
  // old run ran in, not the month it paid, so trusting it would skip a month.
  const lastYm = state.last_ym;
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
    'payroll_auto_run_state',
    { last_ym: ym, last_at: now.toISOString(), generated, skipped: skippedEmployees },
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
  getCalcDefaults,
  splitCtc,
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
  approvePayslip,
  approveMonth,
  listPayslips,
  downloadPayslip,
  recalculatePayslipsFromSettings,
  queueRecalculationFromSettings,
  previewEmployeeSalary,
  mapPayslipRow,
  autoRunPayrollForCompany,
  processAutoPayroll,
  getPayrollChecks,
  resolvePayrollPolicy,
  employmentInMonth,
  monthHasEnded,
  leaverFinalMonthReady,
  lastWorkingDayOf,
  isSettlementMonth,
  // Exported for tests.
  fetchMonthReimbursements,
  applyPublishEffects,
  loadTaxYearHistory,
  assertDraftIsCurrent,
};
