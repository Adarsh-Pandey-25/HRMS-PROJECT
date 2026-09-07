import { apiRequest, apiRequestPaginated } from './client';

// ── Plans ────────────────────────────────────────────────────────────────
export const listPlansApi = (includeInactive = false) =>
  apiRequest({ method: 'GET', url: '/super-admin/plans', params: { include_inactive: includeInactive } });

export const getPlanApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/plans/${id}` });

export const createPlanApi = (payload) => apiRequest({ method: 'POST', url: '/super-admin/plans', data: payload });

export const updatePlanApi = (id, payload) => apiRequest({ method: 'PATCH', url: `/super-admin/plans/${id}`, data: payload });

export const deactivatePlanApi = (id) => apiRequest({ method: 'POST', url: `/super-admin/plans/${id}/deactivate` });

// ── Subscriptions ────────────────────────────────────────────────────────
export const listSubscriptionsApi = (params) =>
  apiRequestPaginated({ method: 'GET', url: '/super-admin/subscriptions', params });

export const getSubscriptionApi = (id) => apiRequest({ method: 'GET', url: `/super-admin/subscriptions/${id}` });

export const createSubscriptionApi = (payload) =>
  apiRequest({ method: 'POST', url: '/super-admin/subscriptions', data: payload });

export const changeSeatsApi = (id, seatCount) =>
  apiRequest({ method: 'POST', url: `/super-admin/subscriptions/${id}/seats`, data: { seat_count: seatCount } });

export const changePlanApi = (id, planId) =>
  apiRequest({ method: 'POST', url: `/super-admin/subscriptions/${id}/plan`, data: { plan_id: planId } });

export const renewSubscriptionApi = (id) => apiRequest({ method: 'POST', url: `/super-admin/subscriptions/${id}/renew` });

export const manualRenewSubscriptionApi = (id, paymentReference, note) =>
  apiRequest({
    method: 'POST',
    url: `/super-admin/subscriptions/${id}/manual-renew`,
    data: { payment_reference: paymentReference, note },
  });

export const cancelSubscriptionApi = (id, reason, immediate) =>
  apiRequest({ method: 'POST', url: `/super-admin/subscriptions/${id}/cancel`, data: { reason, immediate } });

export const suspendSubscriptionApi = (id, reason) =>
  apiRequest({ method: 'POST', url: `/super-admin/subscriptions/${id}/suspend`, data: { reason } });

export const reactivateSubscriptionApi = (id) =>
  apiRequest({ method: 'POST', url: `/super-admin/subscriptions/${id}/reactivate` });

export const listExpiringSubscriptionsApi = (days = 30) =>
  apiRequest({ method: 'GET', url: '/super-admin/subscriptions/expiring', params: { days } });

// ── Invoices ─────────────────────────────────────────────────────────────
export const listInvoicesApi = (params) =>
  apiRequestPaginated({ method: 'GET', url: '/super-admin/invoices', params });

// ── Analytics ────────────────────────────────────────────────────────────
export const getRevenueSummaryApi = () => apiRequest({ method: 'GET', url: '/super-admin/revenue/summary' });

export const getRevenueTrendApi = (period = '12m') =>
  apiRequest({ method: 'GET', url: '/super-admin/revenue/trend', params: { period } });

export const getRevenueByPlanApi = () => apiRequest({ method: 'GET', url: '/super-admin/revenue/by-plan' });

export const getChurnApi = (days = 30) => apiRequest({ method: 'GET', url: '/super-admin/churn', params: { days } });

export const getCohortRetentionApi = (months = 12) =>
  apiRequest({ method: 'GET', url: '/super-admin/revenue/cohorts', params: { months } });

export const listUpcomingRenewalsApi = (days = 30) =>
  apiRequest({ method: 'GET', url: '/super-admin/revenue/upcoming-renewals', params: { days } });

// ── Failed payments + manual credit ─────────────────────────────────────
export const listFailedPaymentsApi = (params) =>
  apiRequestPaginated({ method: 'GET', url: '/super-admin/billing/failed-payments', params });

export const retryFailedPaymentApi = (id) =>
  apiRequest({ method: 'POST', url: `/super-admin/billing/failed-payments/${id}/retry` });

export const issueManualCreditApi = (companyId, amount, reason) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${companyId}/credit`, data: { amount, reason } });

export const issueManualInvoiceApi = (companyId, amount, description, reference) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${companyId}/invoices/manual`, data: { amount, description, reference } });

export const extendSubscriptionApi = (companyId, payload) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${companyId}/subscription/extend`, data: payload });

/** Reconciles an offline payment against an EXISTING invoice — distinct from issueManualInvoiceApi (creates a new one). */
export const recordInvoicePaymentApi = (invoiceId, { paymentMethod, reference, amountReceived, note }) =>
  apiRequest({
    method: 'POST',
    url: `/super-admin/invoices/${invoiceId}/record-payment`,
    data: { payment_method: paymentMethod, reference, amount_received: amountReceived, note },
  });

// ── Coupons ──────────────────────────────────────────────────────────────
export const listCouponsApi = () => apiRequest({ method: 'GET', url: '/super-admin/coupons' });

export const createCouponApi = (payload) => apiRequest({ method: 'POST', url: '/super-admin/coupons', data: payload });

export const deactivateCouponApi = (id) => apiRequest({ method: 'POST', url: `/super-admin/coupons/${id}/deactivate` });

// ── Company-facing seat usage ────────────────────────────────────────────
export const getSeatUsageApi = () => apiRequest({ method: 'GET', url: '/companies/billing/seats' });

// ── Company-facing effective feature set (item 5 — nav gating) ──────────
export const getMyCompanyFeaturesApi = () => apiRequest({ method: 'GET', url: '/companies/me/features' });

// ── Company-facing export authorization (item 6 — bulk export gating) ───
export const getExportStatusApi = () => apiRequest({ method: 'GET', url: '/companies/me/export-status' });

// ── Super-admin: export override (item 6.5) ──────────────────────────────
export const setExportOverrideApi = (companyId, enabled, reason) =>
  apiRequest({ method: 'POST', url: `/super-admin/companies/${companyId}/export-override`, data: { enabled, reason } });

// ── Super-admin: data collection mode (Section G2) ───────────────────────
export const setDataCollectionModeApi = (companyId, featureKey, mode, reason, confirmed) =>
  apiRequest({
    method: 'POST',
    url: `/super-admin/companies/${companyId}/features/${encodeURIComponent(featureKey)}/data-collection`,
    data: { mode, reason, confirmed },
  });
