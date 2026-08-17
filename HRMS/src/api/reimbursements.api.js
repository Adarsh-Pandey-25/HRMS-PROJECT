import { api, apiRequest, apiRequestPaginated } from './client';
import { mapReimbursementFromApi } from '../lib/mappers';

export async function fetchMyReimbursementsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/reimbursements/my-reimbursements', params });
  return items.map(mapReimbursementFromApi);
}

export async function fetchTeamReimbursementsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/reimbursements/team-reimbursements', params });
  return items.map(mapReimbursementFromApi);
}

export async function fetchAllReimbursementsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/reimbursements/all-reimbursements', params });
  return items.map(mapReimbursementFromApi);
}

export async function submitReimbursementApi(formData) {
  const res = await api.post('/reimbursements/submit', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const body = res.data;
  if (!body?.success) throw new Error(body?.error?.message || 'Submit failed');
  const { toCamelCase } = await import('../lib/case');
  return mapReimbursementFromApi(toCamelCase(body.data));
}

export async function approveReimbursementApi(id) {
  const data = await apiRequest({ method: 'PUT', url: `/reimbursements/${id}/approve` });
  return mapReimbursementFromApi(data);
}

export async function rejectReimbursementApi(id, reason = '') {
  const data = await apiRequest({ method: 'PUT', url: `/reimbursements/${id}/reject`, data: { rejection_reason: reason } });
  return mapReimbursementFromApi(data);
}

export async function deleteReimbursementApi(id) {
  return apiRequest({ method: 'DELETE', url: `/reimbursements/${id}` });
}

export async function openReceiptApi(id) {
  const data = await apiRequest({ method: 'GET', url: `/reimbursements/${id}/receipt` });
  const url = data?.url || data?.signedUrl;
  if (!url) throw new Error('Receipt not available');
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}
