import { apiRequest, apiRequestPaginated, apiUpload } from './client';
import { toCamelCase } from '../lib/case';

export const DOCUMENT_TYPE_OPTIONS = [
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'joining_letter', label: 'Joining Letter' },
  { value: 'aadhar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'educational_certificate', label: 'Educational Certificate' },
  { value: 'experience_letter', label: 'Experience Letter' },
  { value: 'payslip', label: 'Payslip' },
  { value: 'form_16', label: 'Form 16' },
  { value: 'resignation_letter', label: 'Resignation Letter' },
  { value: 'relieving_letter', label: 'Relieving Letter' },
];

function mapDocument(row) {
  const c = toCamelCase(row);
  const emp = c.employee || {};
  return {
    id: c.id,
    employeeId: c.employeeId,
    type: c.documentType,
    name: c.documentName,
    url: c.documentUrl,
    isVerified: Boolean(c.isVerified),
    uploadedAt: c.uploadedAt || c.createdAt,
    expiresAt: c.expiresAt,
    employeeName: emp.firstName ? `${emp.firstName} ${emp.lastName}`.trim() : undefined,
  };
}

export async function fetchMyDocumentsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/documents/my-documents', params });
  return items.map(mapDocument);
}

export async function fetchAllDocumentsApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/documents/all', params });
  return items.map(mapDocument);
}

export async function fetchEmployeeDocumentsApi(employeeId, params = {}) {
  const data = await apiRequest({
    method: 'GET',
    url: `/documents/employee/${employeeId}`,
    params,
  });
  const rows = Array.isArray(data) ? data : [];
  return rows.map(mapDocument);
}

export async function uploadDocumentApi({ file, documentType, documentName, employeeId, expiresAt }) {
  const form = new FormData();
  form.append('file', file);
  form.append('document_type', documentType);
  form.append('document_name', documentName || file.name);
  if (employeeId) form.append('employee_id', employeeId);
  if (expiresAt) form.append('expires_at', expiresAt);
  const data = await apiUpload({ method: 'POST', url: '/documents/upload', data: form });
  return mapDocument(data);
}

export async function verifyDocumentApi(id) {
  const data = await apiRequest({ method: 'PUT', url: `/documents/${id}/verify` });
  return mapDocument(data);
}

export async function deleteDocumentApi(id) {
  return apiRequest({ method: 'DELETE', url: `/documents/${id}` });
}

/** Cookie-auth redirect URL (window.open). */
export function documentDownloadUrl(id) {
  const base = import.meta.env.VITE_API_URL || '/api';
  return `${base}/documents/${id}/download`;
}

/** Fetch signed URL with Bearer token, then open in a new tab. */
export async function openDocumentApi(id) {
  const data = await apiRequest({
    method: 'GET',
    url: `/documents/${id}/download`,
    params: { format: 'json' },
  });
  const url = data?.url;
  if (!url) throw new Error('Download URL not available');
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}
