import { apiRequest } from './client';

/** Admin-configurable onboarding checklist templates — company-wide, managed from Settings. */
export async function fetchChecklistTemplatesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/onboarding-checklist-templates' });
  return Array.isArray(rows) ? rows : [];
}

export async function createChecklistTemplateApi({ label, sortOrder }) {
  const data = { label };
  if (sortOrder !== undefined) data.sort_order = sortOrder;
  return apiRequest({ method: 'POST', url: '/onboarding-checklist-templates', data });
}

export async function updateChecklistTemplateApi(id, patch = {}) {
  const data = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.sortOrder !== undefined) data.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) data.is_active = patch.isActive;
  return apiRequest({ method: 'PATCH', url: `/onboarding-checklist-templates/${id}`, data });
}

export async function deleteChecklistTemplateApi(id) {
  return apiRequest({ method: 'DELETE', url: `/onboarding-checklist-templates/${id}` });
}
