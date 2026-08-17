import { apiRequest, apiUpload } from './client';
import { toCamelCase, toSnakeCase } from '../lib/case';

export async function fetchRolePermissionsApi() {
  const row = await apiRequest({ method: 'GET', url: '/settings/role_permissions' });
  const camel = toCamelCase(row);
  return camel?.value ?? null;
}

export async function fetchAllSettingsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/settings' });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchSettingApi(key) {
  const row = await apiRequest({ method: 'GET', url: `/settings/${key}` });
  return toCamelCase(row);
}

export async function updateSettingApi(key, value) {
  const row = await apiRequest({ method: 'PUT', url: `/settings/${key}`, data: { value } });
  return toCamelCase(row);
}

export async function fetchCompanyProfileApi() {
  return apiRequest({ method: 'GET', url: '/settings/company-profile' });
}

export async function uploadCompanyLogoApi(file) {
  const form = new FormData();
  form.append('logo', file);
  return apiUpload({ method: 'POST', url: '/settings/company-logo', data: form });
}

export async function fetchPayrollComponentsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/settings/payroll-components' });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function createPayrollComponentApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/settings/payroll-components', data: toSnakeCase(payload) });
  return toCamelCase(data);
}

export async function updatePayrollComponentApi(id, payload) {
  const data = await apiRequest({ method: 'PUT', url: `/settings/payroll-components/${id}`, data: toSnakeCase(payload) });
  return toCamelCase(data);
}

export async function deletePayrollComponentApi(id) {
  return apiRequest({ method: 'DELETE', url: `/settings/payroll-components/${id}` });
}

export async function fetchLeavePolicyApi() {
  return apiRequest({ method: 'GET', url: '/settings/leave-policy' });
}

/** Backend expects `{ policy: [{ code, name, allocation, active }] }` */
export async function updateLeavePolicyApi(policyArray) {
  return apiRequest({ method: 'PUT', url: '/settings/leave-policy', data: { policy: policyArray } });
}

export async function applyLeavePolicyApi(year) {
  return apiRequest({ method: 'POST', url: '/settings/leave-policy/apply', params: { year } });
}

export async function fetchLeaveAllocationsApi() {
  return apiRequest({ method: 'GET', url: '/settings/leave-allocations' });
}

export async function updateLeaveAllocationsApi(allocations) {
  return apiRequest({
    method: 'PUT',
    url: '/settings/leave-allocations',
    data: { allocations },
  });
}
