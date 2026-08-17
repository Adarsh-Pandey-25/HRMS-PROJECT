import { apiRequest, apiUpload } from './client';

export async function fetchMyCompanyApi() {
  return apiRequest({ method: 'GET', url: '/companies/me' });
}

export async function fetchAccessibleCompaniesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/companies/accessible' });
  return Array.isArray(rows) ? rows : [];
}

export async function fetchChildCompaniesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/companies/children' });
  return Array.isArray(rows) ? rows : [];
}

export async function createChildCompanyApi(payload) {
  return apiRequest({ method: 'POST', url: '/companies/children', data: payload });
}

export async function updateChildCompanyApi(id, payload) {
  return apiRequest({ method: 'PATCH', url: `/companies/children/${id}`, data: payload });
}

export async function fetchCompanyEmployeesApi(companyId) {
  const rows = await apiRequest({ method: 'GET', url: `/companies/${companyId}/employees` });
  return Array.isArray(rows) ? rows : [];
}

export async function uploadCompanyLogoApi(companyId, file) {
  const form = new FormData();
  form.append('logo', file);
  return apiUpload({
    method: 'POST',
    url: `/companies/${companyId}/logo`,
    data: form,
  });
}
