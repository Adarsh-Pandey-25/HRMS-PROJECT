/**
 * Company pay rules — Settings → Payroll → Pay rules, stored as the
 * `payroll_rules` setting. Everything is normalized here on read, so a
 * missing or hand-edited value can never break a payroll run.
 *
 * dayRateBasis   how a day's pay is worked out (loss of pay, overtime rate)
 *                  working  — monthly gross ÷ working days in that month
 *                             (weekly offs excluded, holidays included)
 *                  calendar — monthly gross ÷ days in the month
 *                  fixed    — monthly gross ÷ a fixed number (payroll_working_days, e.g. 26 or 30)
 * late           every `every` late arrivals after `freeLates` free ones cost
 *                a half (or full) day of pay. Off by default.
 * overtime       off | pay (hourly rate × multiplier) | comp_off (a Comp Off
 *                leave day per `compOffHours` overtime hours). Only days with
 *                at least `minMinutes` overtime count; `monthlyCapHours` caps
 *                the month (0 = no cap). Off by default.
 * missedCheckout what a day the employee forgot to check out of counts as —
 *                the system closes it at 4 AM: a full shift (no overtime) or
 *                a half day.
 */
const DAY_RATE_BASES = ['working', 'calendar', 'fixed'];
const OVERTIME_MODES = ['off', 'pay', 'comp_off'];
const LATE_PENALTIES = ['half', 'full'];
const MISSED_CHECKOUT = ['full', 'half'];

const DEFAULT_PAYROLL_RULES = Object.freeze({
  dayRateBasis: 'working',
  late: Object.freeze({ enabled: false, freeLates: 2, every: 3, penalty: 'half' }),
  overtime: Object.freeze({ mode: 'off', multiplier: 1.5, minMinutes: 30, monthlyCapHours: 0, compOffHours: 8 }),
  missedCheckout: 'full',
});

const num = (v, def, { min = 0, max = Infinity, integer = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const clamped = Math.min(max, Math.max(min, n));
  return integer ? Math.round(clamped) : clamped;
};
const oneOf = (v, list, def) => (list.includes(v) ? v : def);

const normalizePayrollRules = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const late = r.late && typeof r.late === 'object' ? r.late : {};
  const ot = r.overtime && typeof r.overtime === 'object' ? r.overtime : {};
  const d = DEFAULT_PAYROLL_RULES;
  return {
    dayRateBasis: oneOf(r.dayRateBasis ?? r.day_rate_basis, DAY_RATE_BASES, d.dayRateBasis),
    late: {
      enabled: late.enabled === true,
      freeLates: num(late.freeLates ?? late.free_lates, d.late.freeLates, { min: 0, max: 31, integer: true }),
      every: num(late.every, d.late.every, { min: 1, max: 31, integer: true }),
      penalty: oneOf(late.penalty, LATE_PENALTIES, d.late.penalty),
    },
    overtime: {
      mode: oneOf(ot.mode, OVERTIME_MODES, d.overtime.mode),
      multiplier: num(ot.multiplier, d.overtime.multiplier, { min: 0.5, max: 5 }),
      minMinutes: num(ot.minMinutes ?? ot.min_minutes, d.overtime.minMinutes, { min: 0, max: 600, integer: true }),
      monthlyCapHours: num(ot.monthlyCapHours ?? ot.monthly_cap_hours, d.overtime.monthlyCapHours, { min: 0, max: 744 }),
      compOffHours: num(ot.compOffHours ?? ot.comp_off_hours, d.overtime.compOffHours, { min: 1, max: 24 }),
    },
    missedCheckout: oneOf(r.missedCheckout ?? r.missed_checkout, MISSED_CHECKOUT, d.missedCheckout),
  };
};

const getPayrollRules = async (companyId) => {
  const settingsService = require('../services/settings.service');
  return normalizePayrollRules(await settingsService.getSetting('payroll_rules', null, companyId));
};

/** Half days of pay lost to late arrivals this month. */
const latePenaltyDays = (lateCount, lateRule) => {
  if (!lateRule?.enabled) return 0;
  const chargeable = Math.max(0, Number(lateCount || 0) - Number(lateRule.freeLates || 0));
  const strikes = Math.floor(chargeable / Math.max(1, Number(lateRule.every || 1)));
  return strikes * (lateRule.penalty === 'full' ? 1 : 0.5);
};

module.exports = {
  DEFAULT_PAYROLL_RULES,
  DAY_RATE_BASES,
  OVERTIME_MODES,
  normalizePayrollRules,
  getPayrollRules,
  latePenaltyDays,
};
