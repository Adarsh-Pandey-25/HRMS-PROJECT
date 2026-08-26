import { apiRequest, apiRequestPaginated, apiUpload } from './client';
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
  const { attachments, ...rest } = data || {};
  const file = Array.isArray(attachments) ? attachments[0] : null;

  if (file) {
    // Backend only accepts a single attachment via multipart/form-data
    // (upload.single('attachment')), so a plain JSON body would silently
    // drop it — build a FormData request instead, matching documents.api.js.
    const snake = toSnakeCase(rest);
    const form = new FormData();
    Object.entries(snake).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'channels' && typeof value === 'object') {
        form.append('channels', JSON.stringify(value));
      } else {
        form.append(key, value);
      }
    });
    form.append('attachment', file);
    const row = await apiUpload({ method: 'POST', url: '/announcements/create', data: form });
    return mapAnnouncementFromApi(row);
  }

  const row = await apiRequest({ method: 'POST', url: '/announcements/create', data: toSnakeCase(rest) });
  return mapAnnouncementFromApi(row);
}

export async function updateAnnouncementApi(id, data) {
  const row = await apiRequest({ method: 'PUT', url: `/announcements/${id}/update`, data: toSnakeCase(data) });
  return mapAnnouncementFromApi(row);
}

export async function deleteAnnouncementApi(id) {
  return apiRequest({ method: 'DELETE', url: `/announcements/${id}` });
}

export async function acknowledgeAnnouncementApi(id) {
  return apiRequest({ method: 'POST', url: `/announcements/${id}/acknowledge` });
}
