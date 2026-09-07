import { apiRequest, apiRequestPaginated } from './client';

// HR/Admin-accessible plan list for the Change Plan modal — /super-admin/plans
// requires super-admin auth, which a tenant employee JWT never has.
export const listBillingPlansApi = () => apiRequest({ method: 'GET', url: '/billing/plans' });
export const getMySubscriptionApi = () => apiRequest({ method: 'GET', url: '/billing/my-subscription' });
export const getMyFeaturesApi = () => apiRequest({ method: 'GET', url: '/billing/my-features' });
export const listMyInvoicesApi = (params) => apiRequestPaginated({ method: 'GET', url: '/billing/my-invoices', params });
export const getMyPaymentMethodApi = () => apiRequest({ method: 'GET', url: '/billing/my-payment-method' });

export const requestChangePlanApi = (planId) => apiRequest({ method: 'POST', url: '/billing/change-plan', data: { plan_id: planId } });
export const requestChangeSeatsApi = (seatCount) => apiRequest({ method: 'POST', url: '/billing/change-seats', data: { seat_count: seatCount } });
export const requestChangeBillingCycleApi = (billingCycle) =>
  apiRequest({ method: 'POST', url: '/billing/change-billing-cycle', data: { billing_cycle: billingCycle } });
export const requestFeatureApi = (featureKey) => apiRequest({ method: 'POST', url: '/billing/request-feature', data: { feature_key: featureKey } });
export const cancelMySubscriptionApi = (reason, confirmCompanyName, immediate = false) =>
  apiRequest({ method: 'POST', url: '/billing/cancel-subscription', data: { reason, confirm_company_name: confirmCompanyName, immediate } });

/** Same fetch-blob-with-credentials pattern as payroll.api.js's downloadPayslipApi. */
export async function downloadMyInvoiceApi(id) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const res = await fetch(`${base}/billing/my-invoices/${id}/download`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || `invoice-${id}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
