import { apiRequest, apiUpload } from './client';
import { mapEmployeeFromApi, toSnakeCase } from '../lib/case';

export async function fetchAllEmployeesApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/employees/all', params });
  return (Array.isArray(rows) ? rows : []).map(mapEmployeeFromApi);
}

export async function fetchTeamEmployeesApi(managerId) {
  const rows = await apiRequest({ method: 'GET', url: `/employees/team/${managerId}` });
  return (Array.isArray(rows) ? rows : []).map(mapEmployeeFromApi);
}

export async function fetchEmployeeByIdApi(id) {
  const employee = await apiRequest({ method: 'GET', url: `/employees/${id}` });
  return mapEmployeeFromApi(employee);
}

export async function createEmployeeApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/employees/create', data: toSnakeCase(payload) });
  const row = data?.employee || data;
  return { employee: mapEmployeeFromApi(row) };
}

export async function updateEmployeeApi(id, payload) {
  const data = await apiRequest({ method: 'PUT', url: `/employees/${id}/update`, data: toSnakeCase(payload) });
  return mapEmployeeFromApi(data);
}

/** Soft offboard — data retained, not deleted. See N-10 resolution. */
export async function offboardEmployeeApi(id, reason) {
  return apiRequest({ method: 'DELETE', url: `/employees/${id}`, data: { reason } });
}

/** Genuine hard delete — only usable on an already-offboarded employee, requires typed confirmation. */
export async function eraseEmployeeApi(id, confirmEmployeeCode, reason) {
  return apiRequest({
    method: 'POST',
    url: `/employees/${id}/erase`,
    data: { confirm_employee_code: confirmEmployeeCode, reason },
  });
}

export async function deactivateEmployeeApi(id) {
  return apiRequest({ method: 'PUT', url: `/employees/${id}/deactivate` });
}

export async function uploadEmployeePhotoApi(id, file) {
  const form = new FormData();
  form.append('photo', file);
  const data = await apiUpload({ method: 'POST', url: `/employees/${id}/photo`, data: form });
  return mapEmployeeFromApi(data);
}

/** Item 3: HR/Admin-only — lets an employee use their one-time self-edit again. */
export async function resetSelfEditLockApi(id, reason) {
  const data = await apiRequest({ method: 'POST', url: `/employees/${id}/reset-self-edit-lock`, data: { reason } });
  return mapEmployeeFromApi(data);
}
