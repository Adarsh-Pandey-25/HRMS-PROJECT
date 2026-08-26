import { apiRequest } from './client';
import { toCamelCase } from '../lib/case';

/** Strip empty/undefined query params so we don't send `department=`. */
function cleanParams(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

export async function fetchTeamPerformanceApi({ month, year, department } = {}) {
  const rows = await apiRequest({
    method: 'GET',
    url: '/reports/team-performance',
    params: cleanParams({ month, year, department }),
  });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchAttendanceSummaryApi({ from, to, department } = {}) {
  const rows = await apiRequest({
    method: 'GET',
    url: '/reports/attendance-summary',
    params: cleanParams({ from, to, department }),
  });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchPayrollSummaryApi({ month, year, department, groupBy } = {}) {
  const rows = await apiRequest({
    method: 'GET',
    url: '/reports/payroll-summary',
    params: cleanParams({ month, year, department, groupBy }),
  });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchLeaveSummaryApi({ year, department, groupBy } = {}) {
  const rows = await apiRequest({
    method: 'GET',
    url: '/reports/leave-summary',
    params: cleanParams({ year, department, groupBy }),
  });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}
