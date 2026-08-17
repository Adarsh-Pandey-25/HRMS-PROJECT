import { apiRequest } from './client';
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

export async function deleteEmployeeApi(id) {
  return apiRequest({ method: 'DELETE', url: `/employees/${id}` });
}

export async function deactivateEmployeeApi(id) {
  return apiRequest({ method: 'PUT', url: `/employees/${id}/deactivate` });
}
