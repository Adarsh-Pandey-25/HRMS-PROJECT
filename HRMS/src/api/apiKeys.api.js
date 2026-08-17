import { apiRequest } from './client';
import { toCamelCase } from '../lib/case';

export async function fetchApiKeyScopesApi() {
  const data = await apiRequest({ method: 'GET', url: '/api-keys/scopes' });
  return toCamelCase(data);
}

export async function fetchApiKeysApi() {
  const rows = await apiRequest({ method: 'GET', url: '/api-keys' });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function createApiKeyApi({ name, scopes, environment = 'live' }) {
  const data = await apiRequest({
    method: 'POST',
    url: '/api-keys',
    data: { name, scopes, environment },
  });
  return toCamelCase(data);
}

export async function revokeApiKeyApi(id) {
  const data = await apiRequest({ method: 'POST', url: `/api-keys/${id}/revoke` });
  return toCamelCase(data);
}
