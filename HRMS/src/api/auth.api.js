import { apiRequest, apiUpload, setStoredToken } from './client';
import { mapEmployeeFromApi } from '../lib/case';

/** Portal-scoped logins for the subdomain-per-tenant Admin/HR/Employee pages hit their
 *  own endpoint; the original generic login (no portal) keeps hitting `/auth/login`. */
const PORTAL_LOGIN_PATHS = {
  admin: '/auth/admin/login',
  hr: '/auth/hr/login',
  employee: '/auth/employee/login',
};

export async function loginApi(email, password, portal) {
  // Remove any token left by older versions; auth now uses HttpOnly cookies.
  setStoredToken(null);
  const url = PORTAL_LOGIN_PATHS[portal] || '/auth/login';
  const data = await apiRequest({
    method: 'POST',
    url,
    data: { email, password },
  });

  return {
    user: mapEmployeeFromApi(data.employee),
  };
}

/** Public — resolves the current Host header to a tenant company, if any (subdomain
 *  routing is not live yet, so `resolved` is false on every deployment today). */
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
export async function verifyOnboardingOtpApi(email, otp) {
  return apiRequest({
    method: 'POST',
    url: '/auth/onboarding/verify-otp',
    data: { email, otp },
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
  form.append('company_profile', JSON.stringify(payload.company_profile || {}));
  if (logoFile) form.append('logo', logoFile);
  return apiUpload({
    method: 'POST',
    url: '/auth/bootstrap-admin',
    data: form,
    timeout: 60_000,
  });
}

/** Public — validate one-time onboarding invite before showing the form. */
export async function peekOnboardingInviteApi(token) {
  return apiRequest({
    method: 'GET',
    url: `/auth/onboarding/invite/${encodeURIComponent(token)}`,
  });
}
