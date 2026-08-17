import { apiRequest, apiRequestPaginated } from './client';
import { mapAnnouncementFromApi } from '../lib/mappers';
import { toSnakeCase } from '../lib/case';

export async function fetchActiveAnnouncementsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/announcements/active' });
  return (Array.isArray(rows) ? rows : []).map(mapAnnouncementFromApi);
}

export async function fetchAllAnnouncementsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/announcements/all', params });
  return items.map(mapAnnouncementFromApi);
}

export async function createAnnouncementApi(data) {
  const row = await apiRequest({ method: 'POST', url: '/announcements/create', data: toSnakeCase(data) });
  return mapAnnouncementFromApi(row);
}

export async function updateAnnouncementApi(id, data) {
  const row = await apiRequest({ method: 'PUT', url: `/announcements/${id}/update`, data });
  return mapAnnouncementFromApi(row);
}

export async function deleteAnnouncementApi(id) {
  return apiRequest({ method: 'DELETE', url: `/announcements/${id}` });
}

export async function acknowledgeAnnouncementApi(id) {
  return apiRequest({ method: 'POST', url: `/announcements/${id}/acknowledge` });
}
