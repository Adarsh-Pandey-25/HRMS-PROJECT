import { apiRequest } from './client';
import { mapGoalFromApi } from '../lib/mappers';
import { toSnakeCase, toCamelCase } from '../lib/case';

export async function fetchMyGoalsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/performance/goals' });
  return (Array.isArray(rows) ? rows : []).map(mapGoalFromApi);
}

export async function createGoalApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/performance/goals', data: toSnakeCase(payload) });
  return mapGoalFromApi(data);
}

export async function updateGoalApi(id, payload) {
  const data = await apiRequest({ method: 'PUT', url: `/performance/goals/${id}`, data: toSnakeCase(payload) });
  return mapGoalFromApi(data);
}

export async function fetchReviewCyclesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/performance/cycles' });
  return toCamelCase(Array.isArray(rows) ? rows : []);
}

export async function createReviewCycleApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/performance/cycles', data: toSnakeCase(payload) });
  return toCamelCase(data);
}

export async function fetchTeamReviewsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/performance/team-reviews' });
  return toCamelCase(Array.isArray(rows) ? rows : []);
}

export async function openTeamReviewsApi(cycleId) {
  const rows = await apiRequest({
    method: 'POST',
    url: '/performance/team-reviews/open',
    data: cycleId ? { cycle_id: cycleId } : {},
  });
  return toCamelCase(Array.isArray(rows) ? rows : []);
}

export async function updateReviewApi(id, payload) {
  const data = await apiRequest({ method: 'PUT', url: `/performance/reviews/${id}`, data: toSnakeCase(payload) });
  return toCamelCase(data);
}
