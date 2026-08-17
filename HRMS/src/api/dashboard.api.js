import { apiRequest } from './client';

const DASHBOARD_PATHS = {
  admin: '/dashboard/admin',
  hr: '/dashboard/hr',
  manager: '/dashboard/manager',
  employee: '/dashboard/employee',
};

export async function fetchDashboardApi(role) {
  const path = DASHBOARD_PATHS[role] || DASHBOARD_PATHS.employee;
  return apiRequest({ method: 'GET', url: path });
}

export async function globalSearchApi(query) {
  return apiRequest({ method: 'GET', url: '/dashboard/search', params: { q: query } });
}
