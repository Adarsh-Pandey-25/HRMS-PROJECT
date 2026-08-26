import { apiRequest, apiUpload } from './client';
import { mapJobFromApi, mapCandidateFromApi } from '../lib/mappers';
import { toSnakeCase } from '../lib/case';

/** Fixed dropdown options for how a candidate found this role — kept in sync with recruitment.service.js CANDIDATE_SOURCES. */
export const CANDIDATE_SOURCE_OPTIONS = [
  { value: 'referral', label: 'Referral' },
  { value: 'job-board', label: 'Job Board' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'direct', label: 'Direct' },
  { value: 'other', label: 'Other' },
];

export const INTERVIEW_MODE_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'in-person', label: 'In-person' },
  { value: 'phone', label: 'Phone' },
];

export const INTERVIEW_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no-show', label: 'No-show' },
];

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

/** Create a candidate via multipart/form-data — resume, if provided, uploads as a real file, never inline in JSON. */
export async function createCandidateApi({ name, email, phone, jobId, source, resume }) {
  const form = new FormData();
  form.append('name', name);
  form.append('email', email);
  if (phone) form.append('phone', phone);
  if (jobId) form.append('job_id', jobId);
  if (source) form.append('source', source);
  if (resume) form.append('resume', resume);
  const data = await apiUpload({ method: 'POST', url: '/recruitment/candidates', data: form });
  return mapCandidateFromApi(data);
}

/** Signed URL to a candidate's uploaded resume — opens in a new tab. */
export async function openCandidateResumeApi(candidateId) {
  const data = await apiRequest({ method: 'GET', url: `/recruitment/candidates/${candidateId}/resume` });
  const url = data?.url;
  if (!url) throw new Error('Resume URL not available');
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}

export async function moveCandidateApi(id, stage) {
  const data = await apiRequest({ method: 'PUT', url: `/recruitment/candidates/${id}/stage`, data: { stage } });
  return mapCandidateFromApi(data);
}

export async function fetchInterviewsApi() {
  return apiRequest({ method: 'GET', url: '/recruitment/interviews' });
}

export async function createInterviewApi(payload) {
  return apiRequest({ method: 'POST', url: '/recruitment/interviews', data: toSnakeCase(payload) });
}

export async function updateInterviewOutcomeApi(id, payload) {
  return apiRequest({ method: 'PUT', url: `/recruitment/interviews/${id}`, data: toSnakeCase(payload) });
}

export async function fetchOffersApi() {
  return apiRequest({ method: 'GET', url: '/recruitment/offers' });
}

export async function createOfferApi(payload) {
  return apiRequest({ method: 'POST', url: '/recruitment/offers', data: toSnakeCase(payload) });
}

/** Company's active checklist templates joined with this candidate's checked state. */
export async function fetchCandidateChecklistApi(candidateId) {
  const rows = await apiRequest({ method: 'GET', url: `/recruitment/candidates/${candidateId}/checklist` });
  return Array.isArray(rows) ? rows : [];
}

export async function toggleCandidateChecklistItemApi(candidateId, templateId, isChecked) {
  return apiRequest({
    method: 'PATCH',
    url: `/recruitment/candidates/${candidateId}/checklist/${templateId}`,
    data: { is_checked: isChecked },
  });
}
