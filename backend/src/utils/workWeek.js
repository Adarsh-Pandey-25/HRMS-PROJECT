const moment = require('moment-timezone');
const { TIMEZONE } = require('./constants');

/**
 * A company's weekly offs (Settings → Payroll → Weekly offs).
 *
 * Stored as the `work_week` setting:
 *   { offDays: { "0": "all", "6": [2, 4] } }
 * keyed by day of week (0 = Sunday … 6 = Saturday). "all" = off every week;
 * an array = off only on those occurrences in the month (1st … 5th) — so
 * "2nd and 4th Saturday off" is { "6": [2, 4] }. A day not listed is a
 * working day.
 *
 * Weekly offs are not absences, are not counted as working days for the
 * per-day pay rate, and get no absent/late emails. Before this they were
 * hard-coded as Saturday + Sunday everywhere.
 */
const DEFAULT_WORK_WEEK = Object.freeze({ offDays: Object.freeze({ 0: 'all', 6: 'all' }) });

const normalizeWorkWeek = (raw) => {
  const src = raw && typeof raw === 'object' ? (raw.offDays || raw.off_days) : null;
  if (!src || typeof src !== 'object') return { offDays: { ...DEFAULT_WORK_WEEK.offDays } };
  const offDays = {};
  for (let dow = 0; dow <= 6; dow += 1) {
    const rule = src[dow] ?? src[String(dow)];
    if (rule === 'all' || rule === true) {
      offDays[dow] = 'all';
    } else if (Array.isArray(rule)) {
      const weeks = [...new Set(rule.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5))].sort();
      if (weeks.length === 5) offDays[dow] = 'all';
      else if (weeks.length) offDays[dow] = weeks;
    }
  }
  // Every day off would make every day a non-working day — no pay rate, no
  // attendance. Refuse it by falling back to the default.
  if (Object.keys(offDays).length === 7 && Object.values(offDays).every((r) => r === 'all')) {
    return { offDays: { ...DEFAULT_WORK_WEEK.offDays } };
  }
  return { offDays };
};

/** Which occurrence of its weekday a date is in its month: 1st … 5th. */
const weekOfMonth = (m) => Math.ceil(m.date() / 7);

const isWeeklyOff = (date, workWeek = DEFAULT_WORK_WEEK) => {
  const m = moment.isMoment(date) ? date : moment.tz(date, TIMEZONE);
  const rule = (workWeek?.offDays || DEFAULT_WORK_WEEK.offDays)[m.day()];
  if (!rule) return false;
  if (rule === 'all') return true;
  return Array.isArray(rule) && rule.includes(weekOfMonth(m));
};

/** Working days (not weekly offs) from `from` to `to`, inclusive. Holidays still count — they are paid days. */
const countWorkingDays = (from, to, workWeek = DEFAULT_WORK_WEEK) => {
  const cursor = moment.tz(from, TIMEZONE).startOf('day');
  const end = moment.tz(to, TIMEZONE).startOf('day');
  let n = 0;
  while (cursor.isSameOrBefore(end, 'day')) {
    if (!isWeeklyOff(cursor, workWeek)) n += 1;
    cursor.add(1, 'day');
  }
  return n;
};

const getWorkWeek = async (companyId) => {
  const settingsService = require('../services/settings.service');
  const raw = await settingsService.getSetting('work_week', null, companyId);
  return normalizeWorkWeek(raw);
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];

/** "Saturday & Sunday", "Sunday + 2nd & 4th Saturday" — for emails and summaries. */
const describeWorkWeek = (workWeek) => {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const every = order.filter((d) => workWeek?.offDays?.[d] === 'all').map((d) => DAY_NAMES[d]);
  const some = order.filter((d) => Array.isArray(workWeek?.offDays?.[d]))
    .map((d) => `${workWeek.offDays[d].map((w) => ORDINAL[w]).join(' & ')} ${DAY_NAMES[d]}`);
  if (!every.length && !some.length) return 'No weekly off';
  const head = every.length > 1 ? `${every.slice(0, -1).join(', ')} & ${every[every.length - 1]}` : every.join('');
  return [head, ...some].filter(Boolean).join(' + ');
};

module.exports = {
  DEFAULT_WORK_WEEK,
  normalizeWorkWeek,
  isWeeklyOff,
  countWorkingDays,
  getWorkWeek,
  describeWorkWeek,
  weekOfMonth,
};
