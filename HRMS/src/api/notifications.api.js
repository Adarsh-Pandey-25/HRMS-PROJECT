import { apiRequest, apiRequestPaginated } from './client';
import { toCamelCase } from '../lib/case';

function mapNotification(row) {
  const c = toCamelCase(row);
  const readRaw = c.isRead ?? c.read ?? row?.is_read ?? row?.isRead;
  return {
    id: c.id,
    type: c.type || 'general',
    title: c.title,
    body: c.message || c.body || '',
    at: c.createdAt || c.created_at || row?.created_at,
    read: readRaw === true || readRaw === 'true' || readRaw === 1,
    link: c.link,
  };
}

export async function fetchNotificationsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/notifications', params });
  return items.map(mapNotification);
}

export async function fetchUnreadCountApi() {
  const data = await apiRequest({ method: 'GET', url: '/notifications/unread-count' });
  return Number(data?.count ?? 0);
}

export async function markNotificationReadApi(id) {
  return apiRequest({ method: 'PUT', url: `/notifications/${id}/read` });
}

export async function markAllNotificationsReadApi() {
  return apiRequest({ method: 'PUT', url: '/notifications/read-all' });
}
