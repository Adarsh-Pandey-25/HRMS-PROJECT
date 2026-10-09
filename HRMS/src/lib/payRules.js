/**
 * Pay rules and weekly offs — the browser's copy of backend
 * utils/payrollRules.js and utils/workWeek.js (keep them in step). The
 * server normalizes again on save and on every read; this copy only drives
 * what Settings → Payroll shows.
 */

export const DEFAULT_PAY_RULES = Object.freeze({
  dayRateBasis: 'working',
  late: Object.freeze({ enabled: false, freeLates: 2, every: 3, penalty: 'half' }),
  overtime: Object.freeze({ mode: 'off', multiplier: 1.5, minMinutes: 30, monthlyCapHours: 0, compOffHours: 8 }),
  missedCheckout: 'full',
});

const num = (v, def, min, max, integer = false) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const c = Math.min(max, Math.max(min, n));
  return integer ? Math.round(c) : c;
};
const oneOf = (v, list, def) => (list.includes(v) ? v : def);

export function normalizePayRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const late = r.late && typeof r.late === 'object' ? r.late : {};
  const ot = r.overtime && typeof r.overtime === 'object' ? r.overtime : {};
  const d = DEFAULT_PAY_RULES;
  return {
    dayRateBasis: oneOf(r.dayRateBasis ?? r.day_rate_basis, ['working', 'calendar', 'fixed'], d.dayRateBasis),
    late: {
      enabled: late.enabled === true,
      freeLates: num(late.freeLates ?? late.free_lates, d.late.freeLates, 0, 31, true),
      every: num(late.every, d.late.every, 1, 31, true),
      penalty: oneOf(late.penalty, ['half', 'full'], d.late.penalty),
    },
    overtime: {
      mode: oneOf(ot.mode, ['off', 'pay', 'comp_off'], d.overtime.mode),
      multiplier: num(ot.multiplier, d.overtime.multiplier, 0.5, 5),
      minMinutes: num(ot.minMinutes ?? ot.min_minutes, d.overtime.minMinutes, 0, 600, true),
      monthlyCapHours: num(ot.monthlyCapHours ?? ot.monthly_cap_hours, d.overtime.monthlyCapHours, 0, 744),
      compOffHours: num(ot.compOffHours ?? ot.comp_off_hours, d.overtime.compOffHours, 1, 24),
    },
    missedCheckout: oneOf(r.missedCheckout ?? r.missed_checkout, ['full', 'half'], d.missedCheckout),
  };
}

/** Half days lost to late arrivals: every `every` lates after `freeLates` free ones. */
export function latePenaltyDays(lateCount, late) {
  if (!late?.enabled) return 0;
  const chargeable = Math.max(0, Number(lateCount || 0) - Number(late.freeLates || 0));
  return Math.floor(chargeable / Math.max(1, Number(late.every || 1))) * (late.penalty === 'full' ? 1 : 0.5);
}

// ── Weekly offs ─────────────────────────────────────────────────────────────
// { offDays: { 0: 'all', 6: [2, 4] } } — 0 = Sunday … 6 = Saturday; 'all' =
// every week; an array = only those weeks of the month (1st … 5th).

export const DEFAULT_WORK_WEEK = Object.freeze({ offDays: Object.freeze({ 0: 'all', 6: 'all' }) });

export function normalizeWorkWeek(raw) {
  const src = raw && typeof raw === 'object' ? (raw.offDays || raw.off_days) : null;
  if (!src || typeof src !== 'object') return { offDays: { ...DEFAULT_WORK_WEEK.offDays } };
  const offDays = {};
  for (let dow = 0; dow <= 6; dow += 1) {
    const rule = src[dow] ?? src[String(dow)];
    if (rule === 'all' || rule === true) offDays[dow] = 'all';
    else if (Array.isArray(rule)) {
      const weeks = [...new Set(rule.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5))].sort();
      if (weeks.length === 5) offDays[dow] = 'all';
      else if (weeks.length) offDays[dow] = weeks;
    }
  }
  if (Object.keys(offDays).length === 7 && Object.values(offDays).every((r) => r === 'all')) {
    return { offDays: { ...DEFAULT_WORK_WEEK.offDays } };
  }
  return { offDays };
}

export function isWeeklyOff(date, workWeek) {
  const rule = workWeek?.offDays?.[date.getDay()];
  if (!rule) return false;
  if (rule === 'all') return true;
  return Array.isArray(rule) && rule.includes(Math.ceil(date.getDate() / 7));
}

/** Working days (not weekly offs) in a month; month is 1–12. */
export function countWorkingDays(year, month, workWeek) {
  const days = new Date(year, month, 0).getDate();
  let n = 0;
  for (let d = 1; d <= days; d += 1) if (!isWeeklyOff(new Date(year, month - 1, d), workWeek)) n += 1;
  return n;
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];

/** "Saturday & Sunday off", "Sunday + 2nd & 4th Saturday off", "No weekly off". */
export function describeWorkWeek(workWeek) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const every = order.filter((d) => workWeek?.offDays?.[d] === 'all').map((d) => DAY_LONG[d]);
  const some = order.filter((d) => Array.isArray(workWeek?.offDays?.[d]))
    .map((d) => `${workWeek.offDays[d].map((w) => ORDINAL[w]).join(' & ')} ${DAY_LONG[d]}`);
  if (!every.length && !some.length) return 'No weekly off';
  const head = every.length > 1 ? `${every.slice(0, -1).join(', ')} & ${every[every.length - 1]}` : every.join('');
  return `${[head, ...some].filter(Boolean).join(' + ')} off`;
}

export const ORDINALS = ORDINAL;
