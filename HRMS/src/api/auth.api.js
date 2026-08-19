import { apiRequest, apiUpload, setStoredToken } from './client';
import { mapEmployeeFromApi } from '../lib/case';

export async function loginApi(email, password) {
  // Remove any token left by older versions; auth now uses HttpOnly cookies.
  setStoredToken(null);
  const data = await apiRequest({
    method: 'POST',
    url: '/auth/login',
    data: { email, password },
  });

  return {
    user: mapEmployeeFromApi(data.employee),
  };
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
