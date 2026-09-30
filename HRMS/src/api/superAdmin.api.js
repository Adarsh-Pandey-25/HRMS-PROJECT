import { apiRequest, apiRequestPaginated } from './client';

/** Super-admin APIs use dedicated HttpOnly cookies (saAccessToken). */

export async function superAdminLoginApi(email, password) {
  // Returns either { admin } (2FA disabled — logged in) or
  // { twoFactorRequired: true, pendingToken } (2FA enabled — needs a second step).
  return apiRequest({
    method: 'POST',
    url: '/super-admin/login',
    data: { email, password },
  });
}

export async function superAdminVerifyTwoFactorApi(pendingToken, code) {
  const data = await apiRequest({
    method: 'POST',
    url: '/super-admin/login/verify-2fa',
    data: { pending_token: pendingToken, code },
  });
  return data?.admin || data;
}

// ── 2FA self-service enrollment ─────────────────────────────────────────
export const startTwoFactorEnrollmentApi = () => apiRequest({ method: 'POST', url: '/super-admin/2fa/enroll' });
export const confirmTwoFactorEnrollmentApi = (code) => apiRequest({ method: 'POST', url: '/super-admin/2fa/confirm', data: { code } });
export const disableTwoFactorApi = (code) => apiRequest({ method: 'POST', url: '/super-admin/2fa/disable', data: { code } });

// ── Module 5: super-admin user management ───────────────────────────────
export const listSuperAdminUsersApi = () => apiRequest({ method: 'GET', url: '/super-admin/admin-users' });
export const createSuperAdminUserApi = (payload) => apiRequest({ method: 'POST', url: '/super-admin/admin-users', data: payload });
export const setSuperAdminUserActiveApi = (id, isActive) =>
  apiRequest({ method: 'PATCH', url: `/super-admin/admin-users/${id}/active`, data: { is_active: isActive } });
export const updateSuperAdminUserRoleApi = (id, role) =>
  apiRequest({ method: 'PATCH', url: `/super-admin/admin-users/${id}/role`, data: { role } });

// ── Module 1: Dashboard ─────────────────────────────────────────────────
export const getDashboardSummaryApi = () => apiRequest({ method: 'GET', url: '/super-admin/dashboard/summary' });
export const getDashboardGrowthApi = (period = '6m') =>
  apiRequest({ method: 'GET', url: '/super-admin/dashboard/growth', params: { period } });
export const getAttentionFeedApi = (limit = 20) =>
  apiRequest({ method: 'GET', url: '/super-admin/dashboard/attention-feed', params: { limit } });

// ── Module 2: Company detail ────────────────────────────────────────────
export const getCompanyProfileApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/companies/${id}/profile` });
export const updateCompanyProfileApi = (id, payload) =>
  apiRequest({ method: 'PATCH', url: `/super-admin/companies/${id}/profile`, data: payload });
export const listCompanyEmployeesApi = (id, params) =>
  apiRequestPaginated({ method: 'GET', url: `/super-admin/companies/${id}/employees`, params });
export const getCompanySubscriptionDetailApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/companies/${id}/subscription` });
export const getCompanyUsageApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/companies/${id}/usage` });
export const getCompanyAuditLogApi = (id, params) =>
  apiRequestPaginated({ method: 'GET', url: `/super-admin/companies/${id}/audit-log`, params });
export const listCompanyNotesApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/companies/${id}/notes` });
export const addCompanyNoteApi = (id, note) => apiRequest({ method: 'POST', url: `/super-admin/companies/${id}/notes`, data: { note } });
export const deleteCompanyNoteApi = (id, noteId) => apiRequest({ method: 'DELETE', url: `/super-admin/companies/${id}/notes/${noteId}` });
export const suspendCompanyApi = (id) => apiRequest({ method: 'POST', url: `/super-admin/companies/${id}/suspend` });
export const reactivateCompanyApi = (id) => apiRequest({ method: 'POST', url: `/super-admin/companies/${id}/reactivate` });

// ── Module 4: Impersonation ──────────────────────────────────────────────
export const startImpersonationApi = (companyId, reason) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${companyId}/impersonate`, data: { reason } });
export const listActiveImpersonationsApi = () => apiRequest({ method: 'GET', url: '/super-admin/impersonation/active' });

// ── Module 6: Feature & seat overrides ───────────────────────────────────
export const getCompanyFeaturesApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/companies/${id}/features` });
export const setCompanyFeatureApi = (id, key, enabled, reason) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${id}/features/${encodeURIComponent(key)}`, data: { enabled, reason } });
export const clearCompanyFeatureApi = (id, key) =>
  apiRequest({ method: 'DELETE', url: `/super-admin/companies/${id}/features/${encodeURIComponent(key)}` });
export const setSeatOverrideApi = (id, maxSeatsOverride) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${id}/seat-override`, data: { max_seats_override: maxSeatsOverride } });

// ── Module 7: System health ──────────────────────────────────────────────
export const getSystemHealthApi = () => apiRequest({ method: 'GET', url: '/super-admin/system/health' });
export const getSystemCronsApi = () => apiRequest({ method: 'GET', url: '/super-admin/system/crons' });
export const getSystemEmailFailuresApi = (hours = 24) =>
  apiRequest({ method: 'GET', url: '/super-admin/system/email-failures', params: { hours } });

export async function superAdminLogoutApi() {
  try {
    await apiRequest({ method: 'POST', url: '/super-admin/logout' });
  } catch {
    /* ignore */
  }
}

export async function superAdminMeApi() {
  return apiRequest({ method: 'GET', url: '/super-admin/me' });
}

export async function listAllCompaniesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/super-admin/companies' });
  return Array.isArray(rows) ? rows : [];
}

export async function setCompanyActiveApi(id, isActive) {
  return apiRequest({
    method: 'PATCH',
    url: `/super-admin/companies/${id}`,
    data: { is_active: isActive },
  });
}

export async function listInvitesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/super-admin/invites' });
  return Array.isArray(rows) ? rows : [];
}

/** Live auto-suggested, guaranteed-currently-available subdomain slug for a company name. */
export async function suggestSlugApi(companyNameHint) {
  const data = await apiRequest({
    method: 'GET',
    url: '/super-admin/invites/suggest-slug',
    params: { company_name_hint: companyNameHint },
  });
  return data?.slug || '';
}

/** { slug, status: 'available' | 'taken' | 'reserved' | 'invalid' } for a typed subdomain. */
export async function checkInviteSlugApi(slug) {
  return apiRequest({
    method: 'GET',
    url: '/super-admin/invites/slug-availability',
    params: { slug },
  });
}

// ── Marketing leads (free-trial requests + contact messages) ──────────────
export async function listLeadsApi({ page = 1, limit = 20, status, type } = {}) {
  return apiRequestPaginated({
    method: 'GET',
    url: '/super-admin/leads',
    params: { page, limit, ...(status ? { status } : {}), ...(type ? { type } : {}) },
  });
}

export async function updateLeadStatusApi(id, status) {
  return apiRequest({ method: 'PATCH', url: `/super-admin/leads/${id}/status`, data: { status } });
}

export async function inviteFromLeadApi(id, { companyName, slug, expiresInDays } = {}) {
  return apiRequest({
    method: 'POST',
    url: `/super-admin/leads/${id}/invite`,
    data: {
      ...(companyName ? { company_name: companyName } : {}),
      ...(slug ? { slug } : {}),
      ...(expiresInDays ? { expires_in_days: expiresInDays } : {}),
    },
  });
}

export async function createInviteApi(payload) {
  return apiRequest({
    method: 'POST',
    url: '/super-admin/invites',
    data: payload,
  });
}

export async function revokeInviteApi(id) {
  return apiRequest({
    method: 'POST',
    url: `/super-admin/invites/${id}/revoke`,
  });
}

/** Public — validate invite before showing onboarding form. */
export async function peekOnboardingInviteApi(token) {
  return apiRequest({
    method: 'GET',
    url: `/auth/onboarding/invite/${encodeURIComponent(token)}`,
  });
}

// ── Email log, catalogue and per-company switches ───────────────────────
/** Every email the platform sent, skipped or failed — newest first.
 *  `companyId` may be 'platform' for email tied to no company. */
export async function listEmailLogApi({ page = 1, limit = 25, companyId, type, status, recipient, from, to } = {}) {
  const params = { page, limit };
  if (companyId) params.company_id = companyId;
  if (type) params.type = type;
  if (status) params.status = status;
  if (recipient) params.recipient = recipient;
  if (from) params.from = from;
  if (to) params.to = to;
  return apiRequestPaginated({ method: 'GET', url: '/super-admin/email-log', params });
}

/** Which email goes to whom, for what, and which switch governs it. */
export const getEmailCatalogApi = () => apiRequest({ method: 'GET', url: '/super-admin/email-catalog' });

export const getCompanyEmailPreferencesApi = (companyId) =>
  apiRequest({ method: 'GET', url: '/super-admin/email-preferences', params: { company_id: companyId } });

export const setCompanyEmailPreferenceApi = (companyId, category, enabled) =>
  apiRequest({
    method: 'PATCH',
    url: `/super-admin/email-preferences/${companyId}/${encodeURIComponent(category)}`,
    data: { enabled },
  });
