const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const subscriptionService = require('./subscription.service');
const featureOverrideService = require('./featureOverride.service');
const { getFeatureMeta } = require('../config/featureRegistry');
const logger = require('../utils/logger');

const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'grace_period', 'suspended'];

const getCurrentSubscriptionOrNull = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*)')
    .eq('company_id', companyId)
    .in('status', LIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  return data;
};

// ── Overview ──────────────────────────────────────────────────────────────

const getMySubscription = async (companyId) => {
  const subscription = await getCurrentSubscriptionOrNull(companyId);
  if (!subscription) return null;
  const seatUsage = await subscriptionService.getSeatUsage(companyId);
  return {
    planName: subscription.plans?.name,
    planCode: subscription.plans?.code,
    price: subscription.price_locked_at_signup,
    billingCycle: subscription.billing_cycle,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    nextRenewalDate: subscription.next_renewal_date,
    autoRenew: subscription.auto_renew,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    seatUsage,
  };
};

const getMyFeatures = async (companyId) => {
  const { features } = await featureOverrideService.getEffectiveFeatures(companyId);
  return features.map((f) => ({
    ...f,
    label: getFeatureMeta(f.key)?.label || f.key,
    requestOnly: !f.comingSoon && !f.effective && !f.selfServeUnlockable,
  }));
};

const listMyInvoices = async (companyId, { page = 1, limit = 20 } = {}) => {
  const offset = (page - 1) * limit;
  const { data, error, count } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*', { count: 'exact' })
    .eq('company_id', companyId)
    .order('issued_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new BadRequestError(error.message);
  return { data: data || [], total: count || 0 };
};

const getInvoiceOrThrow = async (companyId, invoiceId) => {
  const { data, error } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*, companies(name)')
    .eq('id', invoiceId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Invoice not found');
  return data;
};

/**
 * No payment gateway integration exists yet (Section F's own explicit
 * premise) — there is nothing to mask/read. Report the real state honestly
 * rather than fabricate a masked card number.
 */
const getMyPaymentMethod = async () => ({ configured: false, note: 'Payment gateway integration is not yet configured for this platform.' });

// ── Self-serve change requests (pending_payment fallback) ───────────────

const notifySuperAdminOfRequest = async (subject, htmlBody) => {
  const to = process.env.SUPER_ADMIN_EMAIL;
  if (!to) return;
  const { sendEmail } = require('./email.service');
  sendEmail({ to, subject, html: `<p>${htmlBody}</p>` }).catch((e) =>
    logger.warn('[TenantBilling] Super-admin notification failed', { error: e.message }));
};

/**
 * Section F: "do not block this feature on the gateway not existing yet" —
 * every change request lands as a real row in subscription_change_requests
 * (status pending_payment) and super-admin/billing is emailed to complete
 * it manually in the interim. Does NOT touch the live subscription itself
 * — that only happens once a human (super-admin, via the existing
 * changePlan/changeSeats/billing-cycle service functions) actually
 * processes it, same functions Module 5's Assign Subscription flow reuses.
 */
const createChangeRequest = async (companyId, requestType, payload, requestedBy) => {
  const subscription = await getCurrentSubscriptionOrNull(companyId);
  if (!subscription) throw new NotFoundError('No active subscription to change');

  const { data, error } = await supabaseAdmin
    .from('subscription_change_requests')
    .insert({
      company_id: companyId, company_subscription_id: subscription.id, request_type: requestType,
      requested_payload: payload, requested_by: requestedBy,
    })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);

  await notifySuperAdminOfRequest(
    `Billing change request: ${requestType} (company ${companyId})`,
    `A company requested a "${requestType}" change (payload: ${JSON.stringify(payload)}). No payment gateway is wired in yet — please complete this manually via the super-admin subscription tools.`,
  );

  return data;
};

const requestPlanChange = async (companyId, planId, requestedBy) => {
  const { data: plan } = await supabaseAdmin.from('subscription_plans').select('id').eq('id', planId).maybeSingle();
  if (!plan) throw new BadRequestError('Plan not found');
  return createChangeRequest(companyId, 'plan', { planId }, requestedBy);
};
const requestSeatChange = (companyId, seatCount, requestedBy) => createChangeRequest(companyId, 'seats', { seatCount }, requestedBy);
const requestBillingCycleChange = (companyId, billingCycle, requestedBy) => createChangeRequest(companyId, 'billing_cycle', { billingCycle }, requestedBy);

const requestFeature = async (companyId, featureKey, requestedBy) => {
  const meta = getFeatureMeta(featureKey);
  if (meta?.comingSoon) throw new BadRequestError(`${featureKey} is a "Coming soon" feature and cannot be requested yet.`);

  const { data, error } = await supabaseAdmin
    .from('feature_requests')
    .insert({ company_id: companyId, feature_key: featureKey, requested_by: requestedBy })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);

  await notifySuperAdminOfRequest(
    `Feature request: ${featureKey} (company ${companyId})`,
    `A company requested access to "${meta?.label || featureKey}". Review and follow up.`,
  );
  return data;
};

/**
 * Self-serve cancellation: requires the caller to type the company's exact
 * name (the retention-screen "explicit confirmation" step) and always
 * defaults to cancel_at_period_end — reuses the existing
 * cancelSubscription() service function, no duplicate logic. `immediate`
 * is accepted but only ever honored alongside the same confirmation check;
 * the frontend's Cancel flow does not surface it (task: "never instant
 * immediate via self-serve without an explicit confirmation step" — the
 * confirmation IS the company-name check either way).
 */
const cancelMySubscription = async (companyId, { reason, confirmCompanyName, immediate = false }, actorId) => {
  const subscription = await getCurrentSubscriptionOrNull(companyId);
  if (!subscription) throw new NotFoundError('No active subscription to cancel');

  const { data: company, error } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).single();
  if (error) throw new BadRequestError(error.message);

  const typed = String(confirmCompanyName || '').trim().toLowerCase();
  const real = String(company.name || '').trim().toLowerCase();
  if (!typed || typed !== real) {
    throw new ForbiddenError('Confirmation text does not match your company name.');
  }

  return subscriptionService.cancelSubscription(subscription.id, actorId, reason, Boolean(immediate));
};

module.exports = {
  getMySubscription, getMyFeatures, listMyInvoices, getInvoiceOrThrow, getMyPaymentMethod,
  requestPlanChange, requestSeatChange, requestBillingCycleChange, requestFeature, cancelMySubscription,
};
