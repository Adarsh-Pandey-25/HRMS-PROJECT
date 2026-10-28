import { apiRequest, apiRequestPaginated } from './client';

// ── The signed-in employee's own WhatsApp updates ──────────────────────────
export const getMyWhatsAppApi = () => apiRequest({ method: 'GET', url: '/whatsapp/me' });
export const startMyWhatsAppLinkApi = () => apiRequest({ method: 'POST', url: '/whatsapp/me/link' });
export const updateMyWhatsAppGroupsApi = (groups) => apiRequest({ method: 'PUT', url: '/whatsapp/me/groups', data: { groups } });
export const disconnectMyWhatsAppApi = () => apiRequest({ method: 'DELETE', url: '/whatsapp/me/link' });

/** The set WhatsAppUpdatesCard uses on an employee's own profile. */
export const MY_WHATSAPP_API = {
  get: getMyWhatsAppApi,
  start: startMyWhatsAppLinkApi,
  updateGroups: updateMyWhatsAppGroupsApi,
  disconnect: disconnectMyWhatsAppApi,
};

// ── The company-wide switch (HR and admins) ─────────────────────────────────
export const getCompanyWhatsAppApi = () => apiRequest({ method: 'GET', url: '/whatsapp/company' });
export const updateCompanyWhatsAppApi = (body) => apiRequest({ method: 'PUT', url: '/whatsapp/company', data: body });

// ── Super Admin → WhatsApp ──────────────────────────────────────────────────
export const getWhatsAppOverviewApi = () => apiRequest({ method: 'GET', url: '/super-admin/whatsapp/overview' });

export async function listWhatsAppMessagesApi({ page = 1, limit = 25, companyId, status, template } = {}) {
  const params = { page, limit };
  if (companyId) params.company_id = companyId;
  if (status) params.status = status;
  if (template) params.template = template;
  return apiRequestPaginated({ method: 'GET', url: '/super-admin/whatsapp/messages', params });
}

export const setWhatsAppPausedApi = (paused, reason) => apiRequest({
  method: 'PUT', url: '/super-admin/whatsapp/pause', data: { paused, reason },
});
export const getWhatsAppTemplatesApi = () => apiRequest({ method: 'GET', url: '/super-admin/whatsapp/templates' });
export const syncWhatsAppTemplatesApi = () => apiRequest({ method: 'POST', url: '/super-admin/whatsapp/templates/sync' });
export const sendWhatsAppTestApi = (to) => apiRequest({ method: 'POST', url: '/super-admin/whatsapp/test-message', data: { to } });

/** The super admin's own WhatsApp, for platform alerts. */
export const SUPER_ADMIN_WHATSAPP_API = {
  get: () => apiRequest({ method: 'GET', url: '/super-admin/whatsapp/me' }),
  start: () => apiRequest({ method: 'POST', url: '/super-admin/whatsapp/me/link' }),
  updateGroups: (groups) => apiRequest({ method: 'PUT', url: '/super-admin/whatsapp/me/groups', data: { groups } }),
  disconnect: () => apiRequest({ method: 'DELETE', url: '/super-admin/whatsapp/me/link' }),
};
