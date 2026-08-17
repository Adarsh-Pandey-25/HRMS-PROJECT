import { apiRequest } from './client';
import { mapAssetFromApi, mapAssetRequestFromApi } from '../lib/mappers';
import { toSnakeCase } from '../lib/case';

export async function fetchAssetsApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/assets', params });
  return (Array.isArray(rows) ? rows : []).map(mapAssetFromApi);
}

export async function fetchMyAssetsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/assets/mine' });
  return (Array.isArray(rows) ? rows : []).map(mapAssetFromApi);
}

export async function fetchAssetRequestsApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/assets/requests', params });
  return (Array.isArray(rows) ? rows : []).map(mapAssetRequestFromApi);
}

export async function submitAssetRequestApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/assets/requests', data: toSnakeCase(payload) });
  return mapAssetRequestFromApi(data);
}

export async function updateAssetRequestApi(id, status) {
  const data = await apiRequest({ method: 'PUT', url: `/assets/requests/${id}`, data: { status } });
  return mapAssetRequestFromApi(data);
}

export async function createAssetApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/assets', data: toSnakeCase(payload) });
  return mapAssetFromApi(data);
}

export async function updateAssetApi(id, payload) {
  const data = await apiRequest({ method: 'PUT', url: `/assets/${id}`, data: toSnakeCase(payload) });
  return mapAssetFromApi(data);
}

export async function assignAssetApi(id, employeeId) {
  const data = await apiRequest({
    method: 'PUT',
    url: `/assets/${id}/assign`,
    data: { employee_id: employeeId },
  });
  return mapAssetFromApi(data);
}

export async function returnAssetApi(id) {
  const data = await apiRequest({ method: 'PUT', url: `/assets/${id}/return` });
  return mapAssetFromApi(data);
}

export async function fetchAssetCategoriesApi() {
  return apiRequest({ method: 'GET', url: '/assets/categories' });
}

export async function createAssetCategoryApi(payload) {
  return apiRequest({ method: 'POST', url: '/assets/categories', data: toSnakeCase(payload) });
}

/** Default categories when API returns none yet. */
export const DEFAULT_ASSET_CATEGORIES = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Furniture', 'Peripheral'];

export function resolveCategoryOptions(categories = []) {
  const fromApi = (Array.isArray(categories) ? categories : [])
    .map((c) => (typeof c === 'string' ? c : c?.name))
    .filter(Boolean);
  const merged = [...new Set([...fromApi, ...DEFAULT_ASSET_CATEGORIES])];
  return merged.sort((a, b) => a.localeCompare(b));
}
