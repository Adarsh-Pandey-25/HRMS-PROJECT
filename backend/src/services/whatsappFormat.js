const moment = require('moment-timezone');

/**
 * Small, pure helpers that turn records into the short values WhatsApp
 * templates are filled with. Meta rejects a blank that is empty, contains a
 * newline or tab, or has more than four spaces in a row — clean() guarantees
 * none of those, so a template send can never fail on formatting.
 */

const DEFAULT_TIMEZONE = process.env.TZ || 'Asia/Kolkata';
const MAX_VALUE_LENGTH = 60;

// Newlines, tabs and the Unicode line/paragraph separators (U+2028/U+2029),
// built from char codes so the source file itself never contains them.
const LINE_BREAKS = new RegExp(`[\r\n\t${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');

/** One line, single spaces, at most `max` characters, never empty. */
const clean = (value, { max = MAX_VALUE_LENGTH, fallback = '—' } = {}) => {
  const text = String(value ?? '')
    .replace(LINE_BREAKS, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** "Laptop not charging" in typographic quotes, for titles inside a sentence. */
const quoted = (value, max = 50) => `“${clean(value, { max })}”`;

const firstName = (person) => clean(
  person?.first_name || person?.firstName || String(person?.name || '').split(/\s+/)[0],
  { max: 30, fallback: 'there' },
);

const fullName = (person) => clean(
  [person?.first_name || person?.firstName, person?.last_name || person?.lastName].filter(Boolean).join(' ')
    || person?.name,
  { max: 50, fallback: 'A colleague' },
);

const asMoment = (value, tz = DEFAULT_TIMEZONE) => {
  if (!value) return null;
  // Plain dates ('2026-11-03') are calendar days, not instants — never shift them by timezone.
  const m = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? moment.tz(String(value), 'YYYY-MM-DD', tz) : moment(value).tz(tz);
  return m.isValid() ? m : null;
};

/** 3 Nov 2026 */
const formatDate = (value, tz = DEFAULT_TIMEZONE) => {
  const m = asMoment(value, tz);
  return m ? m.format('D MMM YYYY') : '—';
};

/** 3–4 Nov 2026 · 30 Oct – 2 Nov 2026 · 28 Dec 2026 – 2 Jan 2027 · 3 Nov 2026 */
const formatDateRange = (from, to, tz = DEFAULT_TIMEZONE) => {
  const a = asMoment(from, tz);
  const b = asMoment(to || from, tz);
  if (!a) return formatDate(to, tz);
  if (!b || a.isSame(b, 'day')) return a.format('D MMM YYYY');
  if (a.isSame(b, 'month')) return `${a.format('D')}–${b.format('D MMM YYYY')}`;
  if (a.isSame(b, 'year')) return `${a.format('D MMM')} – ${b.format('D MMM YYYY')}`;
  return `${a.format('D MMM YYYY')} – ${b.format('D MMM YYYY')}`;
};

/** 10:42 AM */
const formatTime = (value, tz = DEFAULT_TIMEZONE) => {
  if (!value) return '—';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value))) {
    const m = moment(String(value), ['HH:mm:ss', 'HH:mm']);
    return m.isValid() ? m.format('h:mm A') : '—';
  }
  const m = moment(value);
  return m.isValid() ? m.tz(tz).format('h:mm A') : '—';
};

/** October 2026 */
const formatMonth = (month, year) => {
  const m = moment({ year: Number(year), month: Number(month) - 1, day: 1 });
  return m.isValid() ? m.format('MMMM YYYY') : '—';
};

/** 6h 10m — from decimal hours or minutes. */
const formatHours = (hours) => {
  const total = Math.max(0, Math.round(Number(hours || 0) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** 1 year / 3 years */
const formatYears = (years) => {
  const n = Math.max(1, Math.round(Number(years) || 1));
  return `${n} year${n === 1 ? '' : 's'}`;
};

/** +91•••••43210 — enough to recognise your own number, nothing more. */
const maskPhone = (digits) => {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length < 6) return d ? '•••' : '';
  return `+${d.slice(0, 2)}•••••${d.slice(-5)}`;
};

/** approved / not approved — for decisions passed as status codes. */
const decisionWord = (status) => {
  const s = String(status || '').toLowerCase();
  if (['approved', 'approve', 'accepted', 'verified', 'paid'].includes(s)) return s === 'approve' ? 'approved' : s;
  if (['rejected', 'reject', 'declined', 'denied'].includes(s)) return 'not approved';
  if (['resolved', 'closed'].includes(s)) return s;
  if (['in_progress', 'in-progress', 'open', 'pending', 'reopened', 'on_hold'].includes(s)) {
    return s.replace(/[_-]/g, ' ');
  }
  return clean(s.replace(/[_-]/g, ' '), { max: 30, fallback: 'updated' });
};

module.exports = {
  DEFAULT_TIMEZONE,
  clean,
  quoted,
  firstName,
  fullName,
  formatDate,
  formatDateRange,
  formatTime,
  formatMonth,
  formatHours,
  formatYears,
  maskPhone,
  decisionWord,
};
