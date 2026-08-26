/** Shared helpers for the Reports module — month/year pickers, default ranges, formatting. */

export const MONTH_OPTIONS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

/**
 * Descending list of { value, label } year options from (current + 1) back
 * `span` years — newest first. Select only renders plain strings or
 * { value, label } objects, so plain numbers are wrapped here.
 */
export function buildYearOptions(span = 4) {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current + 1; y >= current - span; y -= 1) years.push({ value: y, label: String(y) });
  return years;
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Default filter range: the current calendar month, as YYYY-MM-DD strings. */
export function currentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/** Best-effort display name for an employee record (camelCased from the API). */
export function employeeName(emp) {
  if (!emp) return 'Employee';
  const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
  return name || emp.employeeCode || 'Employee';
}

export function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}
