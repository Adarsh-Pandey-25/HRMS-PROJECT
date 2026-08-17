import { apiRequest } from './client';
import { mapJobFromApi, mapCandidateFromApi } from '../lib/mappers';
import { toSnakeCase } from '../lib/case';

export async function fetchJobsApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/recruitment/jobs', params });
  return (Array.isArray(rows) ? rows : []).map(mapJobFromApi);
}

export async function createJobApi(payload) {
  const data = await apiRequest({ method: 'POST', url: '/recruitment/jobs', data: toSnakeCase(payload) });
  return mapJobFromApi(data);
}

export async function fetchCandidatesApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/recruitment/candidates', params });
  return (Array.isArray(rows) ? rows : []).map(mapCandidateFromApi);
}

export async function moveCandidateApi(id, stage) {
  const data = await apiRequest({ method: 'PUT', url: `/recruitment/candidates/${id}/stage`, data: { stage } });
  return mapCandidateFromApi(data);
}

export async function fetchInterviewsApi() {
  return apiRequest({ method: 'GET', url: '/recruitment/interviews' });
}

export async function fetchOffersApi() {
  return apiRequest({ method: 'GET', url: '/recruitment/offers' });
}
