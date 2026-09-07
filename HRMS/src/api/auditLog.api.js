import { apiRequestPaginated } from './client';

export async function listAuditLogsApi(params) {
  return apiRequestPaginated({ method: 'GET', url: '/audit-logs', params });
}
