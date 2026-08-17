import { apiRequest } from './client';
import { mapTicketFromApi } from '../lib/mappers';
import { toSnakeCase } from '../lib/case';

export async function fetchMyTicketsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/helpdesk/my-tickets' });
  return (Array.isArray(rows) ? rows : []).map(mapTicketFromApi);
}

export async function fetchAllTicketsApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/helpdesk/tickets', params });
  return (Array.isArray(rows) ? rows : []).map(mapTicketFromApi);
}

export async function createTicketApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/helpdesk/tickets', data: toSnakeCase(payload) });
  return mapTicketFromApi(data);
}

export async function updateTicketStatusApi(id, status) {
  const data = await apiRequest({ method: 'PUT', url: `/helpdesk/tickets/${id}/status`, data: { status } });
  return mapTicketFromApi(data);
}

export async function addTicketCommentApi(id, text) {
  const data = await apiRequest({ method: 'POST', url: `/helpdesk/tickets/${id}/comments`, data: { text } });
  return mapTicketFromApi(data);
}

export async function fetchKbCategoriesApi() {
  return apiRequest({ method: 'GET', url: '/helpdesk/kb/categories' });
}

export async function fetchKbArticlesApi(category) {
  return apiRequest({ method: 'GET', url: '/helpdesk/kb/articles', params: category ? { category } : {} });
}
