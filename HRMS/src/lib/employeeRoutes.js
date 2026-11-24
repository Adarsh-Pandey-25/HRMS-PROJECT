const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

/** Company admin accounts are not shown in the employee directory. */
export function isDirectoryEmployee(employee) {
  return employee?.role !== 'admin';
}

export function filterDirectoryEmployees(employees = []) {
  return (Array.isArray(employees) ? employees : []).filter(isDirectoryEmployee);
}

const codeOf = (e) => String(e?.employeeCode || e?.employee_code || '').trim();

/**
 * How often each employee code appears across everyone the signed-in person
 * can see, from the latest full list (useEmployees). Codes restart per company
 * — the primary company's EMP001 and a subsidiary's EMP001 — and links are
 * often built from a filtered list (the directory hides Admins), so the list
 * a link is built from can't tell on its own (owner's report, 24 Nov 2026).
 * `complete`: the list was the whole organisation, not a page of it.
 */
let codeRegistry = { counts: new Map(), complete: false };

export function rememberEmployeeCodes(employees, { complete = false } = {}) {
  const counts = new Map();
  for (const e of Array.isArray(employees) ? employees : []) {
    const code = codeOf(e);
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  codeRegistry = { counts, complete };
}

/**
 * Readable profile URL segment (EMP001…), or the UUID whenever the code isn't
 * known to be unique: shared with another employee (in `roster` or anywhere
 * in the organisation), or the organisation list was only partly loaded.
 */
export function employeeSlug(employee, roster) {
  if (!employee) return '';
  const code = codeOf(employee);
  const id = employee.id || '';
  if (!code) return id;
  if (id && codeRegistry.counts.size && (!codeRegistry.complete || (codeRegistry.counts.get(code) || 0) > 1)) return id;
  if (Array.isArray(roster) && roster.length > 0) {
    const matches = roster.filter(
      (e) => String(e.employeeCode || e.employee_code || '').trim() === code,
    );
    if (matches.length > 1) return id;
  }
  return code;
}

/**
 * The profile URL — optionally opening a tab with extra values, e.g.
 * employeeProfilePath(e, roster, { tab: 'attendance', from: '2026-11-01' }).
 */
export function employeeProfilePath(employee, roster, query) {
  const slug = employeeSlug(employee, roster);
  if (!slug) return '/employees';
  const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v != null && v !== '')).toString();
  return `/employees/${encodeURIComponent(slug)}${qs ? `?${qs}` : ''}`;
}

export function employeeEditPath(employee, roster) {
  return `${employeeProfilePath(employee, roster)}/edit`;
}

/** Resolve a route slug (employee code or UUID) to the internal employee UUID when known. */
export function resolveEmployeeId(slug, employeeMap = {}) {
  if (!slug) return undefined;
  if (isUuid(slug)) return slug;
  return employeeMap[slug]?.id || slug;
}

/** True when `/employees/:slug` refers to the logged-in user (by UUID or employee code). */
export function isOwnEmployeeProfileSlug(slug, user) {
  if (!slug || !user) return false;
  const s = decodeURIComponent(String(slug)).trim().toLowerCase();
  if (!s) return false;
  const id = String(user.id || '').trim().toLowerCase();
  const code = String(user.employeeCode || user.employee_code || '').trim().toLowerCase();
  return (id && s === id) || (code && s === code);
}
