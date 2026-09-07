const { supabaseAdmin } = require('../config/supabase');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const subscriptionService = require('../services/subscription.service');
const analyticsService = require('../services/subscriptionAnalytics.service');
const auditLogService = require('../services/auditLog.service');

// ── Lifecycle actions ───────────────────────────────────────────────────────

const create = async (req, res, next) => {
  try {
    const {
      company_id: companyId, plan_id: planId, billing_cycle: billingCycle, seat_count: seatCount,
      initial_status: initialStatus,
    } = req.body || {};
    if (!companyId || !planId || !billingCycle || !seatCount) {
      throw new BadRequestError('company_id, plan_id, billing_cycle and seat_count are required');
    }
    // Item 5: lets the "Assign Subscription" action on Company Detail start
    // a company as trialing instead of always active — same createSubscription
    // used by every other subscription-creation path, not a second one.
    const status = ['trialing', 'active'].includes(initialStatus) ? initialStatus : 'active';
    const result = await subscriptionService.createSubscription(
      companyId, planId, billingCycle, Number(seatCount), req.superAdmin.id, null, status,
    );
    await auditLogService.logSuperAdminAudit({
      companyId, superAdminId: req.superAdmin.id, actionType: 'subscription_assigned',
      targetType: 'company_billing_subscription', targetId: result.subscription.id,
      afterState: { planId, billingCycle, seatCount: Number(seatCount), status },
    });
    successResponse(res, 'Subscription created', result, null, 201);
  } catch (err) { next(err); }
};

const changeSeats = async (req, res, next) => {
  try {
    const seatCount = Number(req.body?.seat_count);
    const updated = await subscriptionService.changeSeats(req.params.id, seatCount, req.superAdmin.id);
    successResponse(res, 'Seat count updated', updated);
  } catch (err) { next(err); }
};

const changePlan = async (req, res, next) => {
  try {
    const { plan_id: planId } = req.body || {};
    if (!planId) throw new BadRequestError('plan_id is required');
    const updated = await subscriptionService.changePlan(req.params.id, planId, req.superAdmin.id);
    successResponse(res, 'Plan changed', updated);
  } catch (err) { next(err); }
};

const renew = async (req, res, next) => {
  try {
    const result = await subscriptionService.renewSubscription(req.params.id, req.superAdmin.id, true);
    successResponse(res, 'Subscription renewed', result);
  } catch (err) { next(err); }
};

const manualRenew = async (req, res, next) => {
  try {
    const { payment_reference: paymentReference, note } = req.body || {};
    const result = await subscriptionService.manualRenewSubscription(req.params.id, req.superAdmin.id, paymentReference, note);
    successResponse(res, 'Subscription renewed (offline payment)', result);
  } catch (err) { next(err); }
};

const cancel = async (req, res, next) => {
  try {
    const { reason, immediate } = req.body || {};
    const updated = await subscriptionService.cancelSubscription(req.params.id, req.superAdmin.id, reason, Boolean(immediate));
    successResponse(res, immediate ? 'Subscription cancelled' : 'Subscription will cancel at period end', updated);
  } catch (err) { next(err); }
};

const suspend = async (req, res, next) => {
  try {
    const updated = await subscriptionService.suspendSubscription(req.params.id, req.superAdmin.id, req.body?.reason);
    successResponse(res, 'Subscription suspended', updated);
  } catch (err) { next(err); }
};

const reactivate = async (req, res, next) => {
  try {
    const updated = await subscriptionService.reactivateSubscription(req.params.id, req.superAdmin.id);
    successResponse(res, 'Subscription reactivated', updated);
  } catch (err) { next(err); }
};

// ── List / detail ────────────────────────────────────────────────────────

const list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    let query = supabaseAdmin
      .from('company_billing_subscriptions')
      .select('*, plans:subscription_plans(id, name, code), companies(id, name, slug)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.plan_id) query = query.eq('plan_id', req.query.plan_id);
    if (req.query.billing_cycle) query = query.eq('billing_cycle', req.query.billing_cycle);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data || []).map((s) => ({
      ...s,
      mrr: analyticsService.monthlyEquivalent(s.price_locked_at_signup, s.billing_cycle),
    }));

    successResponse(res, 'Subscriptions fetched', rows, buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

const getOne = async (req, res, next) => {
  try {
    const subscription = await subscriptionService.getSubscriptionOrThrow(req.params.id);

    const [{ data: invoices, error: invoicesError }, { data: events, error: eventsError }, { data: notifications, error: notificationsError }] = await Promise.all([
      supabaseAdmin.from('subscription_invoices').select('*').eq('company_subscription_id', req.params.id).order('issued_at', { ascending: false }),
      supabaseAdmin.from('subscription_events').select('*').eq('company_subscription_id', req.params.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('subscription_notifications_log').select('*').eq('company_subscription_id', req.params.id).order('sent_at', { ascending: false }).limit(100),
    ]);
    if (invoicesError) throw invoicesError;
    if (eventsError) throw eventsError;
    if (notificationsError) throw notificationsError;

    const seatUsage = await subscriptionService.getSeatUsage(subscription.company_id);

    successResponse(res, 'Subscription fetched', {
      subscription,
      seatUsage,
      invoices: invoices || [],
      events: events || [],
      notifications: notifications || [],
    });
  } catch (err) { next(err); }
};

// ── Invoices (cross-company) ────────────────────────────────────────────────

const listInvoices = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query);
    let query = supabaseAdmin
      .from('subscription_invoices')
      .select('*, companies(id, name, slug)', { count: 'exact' })
      .order('issued_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.company_id) query = query.eq('company_id', req.query.company_id);
    if (req.query.billing_cycle) query = query.eq('billing_cycle', req.query.billing_cycle);

    const { data, error, count } = await query;
    if (error) throw error;
    successResponse(res, 'Invoices fetched', data || [], buildMeta(page, limit, count));
  } catch (err) { next(err); }
};

// ── Analytics ────────────────────────────────────────────────────────────

const revenueSummary = async (req, res, next) => {
  try {
    successResponse(res, 'Revenue summary', await analyticsService.revenueSummary());
  } catch (err) { next(err); }
};

const revenueTrend = async (req, res, next) => {
  try {
    const period = String(req.query.period || '12m');
    const months = period === '6m' ? 6 : 12;
    successResponse(res, 'Revenue trend', await analyticsService.revenueTrend(months));
  } catch (err) { next(err); }
};

const revenueByPlan = async (req, res, next) => {
  try {
    successResponse(res, 'Revenue by plan', await analyticsService.revenueByPlan());
  } catch (err) { next(err); }
};

const churn = async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    successResponse(res, 'Churn', await analyticsService.churn(days));
  } catch (err) { next(err); }
};

const expiring = async (req, res, next) => {
  try {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    successResponse(res, 'Expiring subscriptions', await analyticsService.expiringSubscriptions(days));
  } catch (err) { next(err); }
};

module.exports = {
  create, changeSeats, changePlan, renew, manualRenew, cancel, suspend, reactivate,
  list, getOne, listInvoices,
  revenueSummary, revenueTrend, revenueByPlan, churn, expiring,
};
