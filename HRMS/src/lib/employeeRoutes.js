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

/**
 * Readable profile URL segment (EMP001…).
 * Falls back to UUID only when the same employee code appears more than once
 * in `roster` (codes restart per company).
 */
export function employeeSlug(employee, roster) {
  if (!employee) return '';
  const code = String(employee.employeeCode || employee.employee_code || '').trim();
  const id = employee.id || '';
  if (!code) return id;
  if (Array.isArray(roster) && roster.length > 0) {
    const matches = roster.filter(
      (e) => String(e.employeeCode || e.employee_code || '').trim() === code,
    );
    if (matches.length > 1) return id;
  }
  return code;
}

export function employeeProfilePath(employee, roster) {
  const slug = employeeSlug(employee, roster);
  return slug ? `/employees/${encodeURIComponent(slug)}` : '/employees';
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
