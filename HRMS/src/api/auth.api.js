import { apiRequest, apiUpload, setStoredToken } from './client';
import { mapEmployeeFromApi } from '../lib/case';

/** Each company login page (/, /admin, /hr on the company subdomain) posts to its own
 *  portal endpoint, which also enforces the role and the company server-side. */
const PORTAL_LOGIN_PATHS = {
  admin: '/auth/admin/login',
  hr: '/auth/hr/login',
  employee: '/auth/employee/login',
};

export async function loginApi(email, password, portal) {
  // Remove any token left by older versions; auth now uses HttpOnly cookies.
  setStoredToken(null);
  const url = PORTAL_LOGIN_PATHS[portal] || PORTAL_LOGIN_PATHS.employee;
  const data = await apiRequest({
    method: 'POST',
    url,
    data: { email, password },
  });

  if (data?.requires2FA) {
    return { requires2FA: true, twoFaToken: data.twoFaToken };
  }
  return {
    user: mapEmployeeFromApi(data.employee),
  };
}

/** Second login step for accounts with two-factor authentication. */
export async function verifyTwoFactorLoginApi(twoFaToken, code) {
  const data = await apiRequest({
    method: 'POST',
    url: '/auth/2fa/verify-login',
    data: { twoFaToken, code },
  });
  return { user: mapEmployeeFromApi(data.employee) };
}

/** Company host side of a super-admin impersonation handoff. */
export async function startImpersonationApi(token) {
  return apiRequest({ method: 'POST', url: '/auth/impersonation/start', data: { token } });
}

/** Employee self-onboarding (token from the emailed /employee-onboarding link). */
const onboardingHeaders = (token) => ({ Authorization: `Bearer ${token}` });

export async function fetchEmployeeOnboardingApi(token) {
  return apiRequest({ method: 'GET', url: '/onboarding/me', headers: onboardingHeaders(token) });
}

export async function uploadEmployeeOnboardingPhotoApi(token, file) {
  const form = new FormData();
  form.append('photo', file);
  return apiUpload({
    method: 'POST', url: '/onboarding/upload-photo', data: form, headers: onboardingHeaders(token),
  });
}

export async function completeEmployeeOnboardingApi(token, payload) {
  return apiRequest({
    method: 'PUT', url: '/onboarding/complete', data: payload, headers: onboardingHeaders(token),
  });
}

/** Public — resolves the current Host header to a tenant company: name, slug,
 *  logo and brand colour for the login page. 404 WORKSPACE_NOT_FOUND on an
 *  unknown subdomain. */
export async function fetchWorkspaceApi() {
  return apiRequest({
    method: 'GET',
    url: '/auth/workspace',
  });
}

export async function logoutApi() {
  try {
    await apiRequest({ method: 'POST', url: '/auth/logout' });
  } finally {
    setStoredToken(null);
  }
}

export async function fetchMeApi() {
  const employee = await apiRequest({ method: 'GET', url: '/auth/me' });
  return mapEmployeeFromApi(employee);
}

/** Request a 6-digit OTP via SMTP (nodemailer on backend). */
export async function forgotPasswordApi(email) {
  return apiRequest({
    method: 'POST',
    url: '/auth/forgot-password',
    data: { email },
  });
}

/** Reset password with email + OTP from inbox. */
export async function resetPasswordApi({ email, otp, newPassword }) {
  return apiRequest({
    method: 'POST',
    url: '/auth/reset-password',
    data: { email, otp, newPassword },
  });
}

/** Change password while logged in (current + new). */
export async function changePasswordApi({ currentPassword, newPassword }) {
  return apiRequest({
    method: 'PUT',
    url: '/auth/change-password',
    data: { currentPassword, newPassword },
  });
}

/** Request OTP to verify admin email during company onboarding. */
export async function sendOnboardingOtpApi(email, adminName, inviteToken) {
  return apiRequest({
    method: 'POST',
    url: '/auth/onboarding/send-otp',
    data: { email, adminName, inviteToken },
    timeout: 60_000,
  });
}

/** Verify onboarding OTP — returns verificationToken for Launch. */
export async function verifyOnboardingOtpApi(email, otp, inviteToken) {
  return apiRequest({
    method: 'POST',
    url: '/auth/onboarding/verify-otp',
    data: { email, otp, inviteToken },
  });
}

/** Create a company + first admin during onboarding (requires inviteToken). */
export async function bootstrapAdminApi(payload, logoFile) {
  const form = new FormData();
  form.append('email', payload.email || payload.admin_email || '');
  form.append('admin_email', payload.admin_email || payload.email || '');
  form.append('admin_name', payload.admin_name || '');
  if (payload.verificationToken) form.append('verificationToken', payload.verificationToken);
  if (payload.inviteToken) form.append('inviteToken', payload.inviteToken);
  if (payload.workspaceSlug) form.append('workspaceSlug', payload.workspaceSlug);
  form.append('company_profile', JSON.stringify(payload.company_profile || {}));
  if (logoFile) form.append('logo', logoFile);
  return apiUpload({
    method: 'POST',
    url: '/auth/bootstrap-admin',
    data: form,
    timeout: 60_000,
  });
}

/** Live availability of the editable workspace address during company onboarding.
 *  Resolves to { slug, status: 'available' | 'taken' | 'reserved' | 'invalid' }. */
export async function checkOnboardingSlugApi(slug, inviteToken) {
  return apiRequest({
    method: 'GET',
    url: '/auth/onboarding/slug-availability',
    params: { slug, inviteToken },
  });
}

/** Public — validate one-time onboarding invite before showing the form. */
export async function peekOnboardingInviteApi(token) {
  return apiRequest({
    method: 'GET',
    url: `/auth/onboarding/invite/${encodeURIComponent(token)}`,
  });
}

/** Self-service 2FA. `enroll` returns { qrDataUri, manualEntryKey, otpauthUri }
 *  for a pending secret; `confirm` switches it on; `disable` needs a current code. */
export async function startTwoFactorEnrollApi() {
  return apiRequest({ method: 'POST', url: '/auth/2fa/enroll' });
}

export async function confirmTwoFactorApi(code) {
  return apiRequest({ method: 'POST', url: '/auth/2fa/confirm', data: { code } });
}

export async function disableTwoFactorApi(code) {
  return apiRequest({ method: 'POST', url: '/auth/2fa/disable', data: { code } });
}
