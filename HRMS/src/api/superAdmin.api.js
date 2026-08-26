import { apiRequest } from './client';

/** Super-admin APIs use dedicated HttpOnly cookies (saAccessToken). */

export async function superAdminLoginApi(email, password) {
  const data = await apiRequest({
    method: 'POST',
    url: '/super-admin/login',
    data: { email, password },
  });
  return data?.admin || data;
}

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
