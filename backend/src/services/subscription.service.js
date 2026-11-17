const crypto = require('crypto');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const {
  BadRequestError, NotFoundError, ConflictError, ForbiddenError,
} = require('../utils/errors');
const config = require('../config/database');
const { getInvoiceNumber } = require('./invoiceNumber.service');
const { grossAmount } = require('../utils/gst');

/** Free trial length for new workspaces. The trial ends at current_period_end. */
const TRIAL_DAYS = Math.max(1, parseInt(process.env.TRIAL_DAYS ?? '7', 10) || 7);

const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'grace_period'];

const getPlanOrThrow = async (planId) => {
  const { data: plan, error } = await supabaseAdmin.from('subscription_plans').select('*').eq('id', planId).maybeSingle();
  if (error) throw error;
  if (!plan) throw new NotFoundError('Plan not found');
  return plan;
};

const getSubscriptionOrThrow = async (subscriptionId) => {
  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Subscription not found');
  return data;
};

/**
 * Base + per-seat pricing for one billing cycle. No quarterly per-seat price
 * exists in the data model (only monthly/annual per-seat rates are defined,
 * per the requested schema) — quarterly per-seat charge is assumed to be
 * 3x the monthly per-seat rate. Flagged assumption; adjust here if the
 * business wants quarterly per-seat priced differently from 3x monthly.
 */
const computeCyclePrice = (plan, billingCycle, seatCount) => {
  const extraSeats = Math.max(0, Number(seatCount) - Number(plan.included_seats || 0));
  if (billingCycle === 'monthly') {
    return Number(plan.base_price_monthly) + extraSeats * Number(plan.price_per_seat_monthly);
  }
  if (billingCycle === 'quarterly') {
    return Number(plan.base_price_quarterly) + extraSeats * Number(plan.price_per_seat_monthly) * 3;
  }
  if (billingCycle === 'annual') {
    return Number(plan.base_price_annual) + extraSeats * Number(plan.price_per_seat_annual);
  }
  throw new BadRequestError('Invalid billing cycle');
};

const cyclePeriodEnd = (start, billingCycle) => {
  const m = moment(start);
  if (billingCycle === 'monthly') return m.add(1, 'month').toISOString();
  if (billingCycle === 'quarterly') return m.add(3, 'month').toISOString();
  if (billingCycle === 'annual') return m.add(1, 'year').toISOString();
  throw new BadRequestError('Invalid billing cycle');
};

const nextInvoiceNumber = async () => getInvoiceNumber('INV');

const logSubscriptionEvent = async (subscriptionId, eventType, triggeredBy, triggeredByUserId, metadata = {}) => {
  const { error } = await supabaseAdmin.from('subscription_events').insert({
    company_subscription_id: subscriptionId,
    event_type: eventType,
    triggered_by: triggeredBy,
    triggered_by_user_id: triggeredByUserId || null,
    metadata,
  });
  if (error) logger.error('[Subscription] Failed to log event', { subscriptionId, eventType, error: error.message });
};

/**
 * Finds this subscription's existing 'draft' invoice (created by a prior
 * seat/plan change awaiting the next renewal) or creates a fresh one, then
 * appends a line item. Draft invoices accumulate proration entries so they
 * never get silently absorbed — see changeSeats/changePlan below — and get
 * finalized (base cycle charge added, status flipped to 'pending') by
 * renewSubscription/manualRenewSubscription.
 */
const appendDraftInvoiceLineItem = async (subscription, lineItem) => {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*')
    .eq('company_subscription_id', subscription.id)
    .eq('status', 'draft')
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const lineItems = [...(existing.line_items || []), lineItem];
    const amount = lineItems.reduce((sum, li) => sum + Number(li.amount || 0), 0);
    const { error } = await supabaseAdmin
      .from('subscription_invoices')
      .update({ line_items: lineItems, amount })
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data: created, error } = await supabaseAdmin
    .from('subscription_invoices')
    .insert({
      company_subscription_id: subscription.id,
      company_id: subscription.company_id,
      invoice_number: await nextInvoiceNumber(),
      amount: Number(lineItem.amount),
      currency: 'INR',
      billing_cycle: subscription.billing_cycle,
      seat_count_at_invoice: subscription.seat_count,
      status: 'draft',
      line_items: [lineItem],
    })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
};

/** Daily-rate proration for the remainder of the current billing period. */
const prorateForRemainder = (subscription, oldCyclePrice, newCyclePrice) => {
  const periodStart = moment(subscription.current_period_start);
  const periodEnd = moment(subscription.current_period_end);
  const totalDays = Math.max(1, periodEnd.diff(periodStart, 'days'));
  const remainingDays = Math.max(0, periodEnd.diff(moment(), 'days'));
  const delta = newCyclePrice - oldCyclePrice;
  return Math.round((delta * (remainingDays / totalDays)) * 100) / 100;
};

// ============================================================================
// Billing root: a subsidiary is billed through its top parent
// ============================================================================
//
// A subsidiary (companies.parent_company_id set, company_type 'child') has no
// plan of its own. Its employees use the parent's seats (one pool for the
// whole group), it gets the parent's features, and it is blocked when the
// parent is suspended. Seat, feature and suspension checks all start from
// getBillingAccount() / isBillingSuspended() below.

/** Parent links followed at most; a longer chain is bad data, not guessed at. */
const MAX_PARENT_DEPTH = 5;
const CHAIN_CACHE_MS = 60 * 1000;
const chainCache = new Map();

const isMissingParentColumn = (error) => {
  const msg = String(error?.message || error?.details || '');
  return /parent_company_id/i.test(msg) && /does not exist/i.test(msg);
};

/** One company's id, name and parent link, or null when there is no such company. */
const readCompanyLink = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, parent_company_id')
    .eq('id', companyId)
    .maybeSingle();
  if (!error) return data;
  if (!isMissingParentColumn(error)) throw error;
  // Hierarchy migration not applied here: every company stands alone.
  const { data: basic, error: basicError } = await supabaseAdmin
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();
  if (basicError) throw basicError;
  return basic ? { ...basic, parent_company_id: null } : null;
};

/**
 * The company and the companies above it, nearest first:
 * [{ id, name }, parent, …, top parent]. Cached for a minute — a company's
 * parent is set when it is created and never moves. A loop in the links, or
 * more than MAX_PARENT_DEPTH parents, is refused (the company is blocked)
 * rather than billed to a guess.
 */
const getCompanyChain = async (companyId) => {
  if (!companyId) return [];
  const key = String(companyId);
  const hit = chainCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const chain = [];
  let nextId = key;
  while (nextId) {
    if (chain.some((c) => c.id === nextId)) {
      logger.error('[Billing] Parent-company links loop', { companyId: key, chain: chain.map((c) => c.id) });
      throw new ForbiddenError('This company\'s parent-company link loops back on itself, so its billing can\'t be worked out. Contact support.');
    }
    if (chain.length > MAX_PARENT_DEPTH) {
      logger.error('[Billing] Parent-company chain too deep', { companyId: key, chain: chain.map((c) => c.id) });
      throw new ForbiddenError(`This company is more than ${MAX_PARENT_DEPTH} levels below its top parent company, so its billing can't be worked out. Contact support.`);
    }
    const row = await readCompanyLink(nextId);
    if (!row) break;
    chain.push({ id: String(row.id), name: row.name || null });
    nextId = row.parent_company_id ? String(row.parent_company_id) : null;
  }
  // Unknown company: stands alone, and isn't cached (it may be created next).
  if (!chain.length) return [{ id: key, name: null }];
  chainCache.set(key, { value: chain, expires: Date.now() + CHAIN_CACHE_MS });
  return chain;
};

/** The top parent of this company's group (the company itself when it has no parent). */
const getBillingRoot = async (companyId) => {
  const chain = await getCompanyChain(companyId);
  return chain.length ? chain[chain.length - 1].id : null;
};

/** The company and every company below it (subsidiaries, theirs, …), itself first. */
const getGroupCompanyIds = async (companyId) => {
  const ids = [String(companyId)];
  let frontier = [String(companyId)];
  for (let depth = 0; frontier.length && depth < MAX_PARENT_DEPTH; depth += 1) {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('id')
      .in('parent_company_id', frontier);
    if (error) {
      if (isMissingParentColumn(error)) break;
      throw error;
    }
    frontier = (data || []).map((r) => String(r.id)).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
};

/** The live subscription, else the suspended one, else the most recent (rows newest first). */
const pickGoverningSubscription = (rows) => rows.find((r) => LIVE_STATUSES.includes(r.status))
  || rows.find((r) => r.status === 'suspended')
  || rows[0]
  || null;

/**
 * Who pays for this company, and with which subscription.
 *
 * The payer is the highest company in the chain (self → top parent) that has
 * ever had a subscription — normally the top parent. While a parent has one,
 * a subsidiary is never billed on its own: a subscription it was given
 * directly in the past is ignored for seats and features. Only when no
 * company above it was ever billed does a subsidiary's own subscription
 * still apply to it.
 *
 * subscription: the payer's live one, else its suspended one, else its most
 * recent (cancelled/expired) one. null = the payer was never billed at all
 * (the default company, or a company set up without a plan); callers keep
 * their long-standing "no subscription" behaviour for those.
 */
const getBillingAccount = async (companyId) => {
  const chain = await getCompanyChain(companyId);
  if (!chain.length) {
    return {
      companyId: null, companyName: null, rootId: null, billingCompanyId: null, billingCompanyName: null,
      chain: [], billedThroughParent: false, subscription: null,
    };
  }
  const ids = chain.map((c) => c.id);
  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*)')
    .in('company_id', ids)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const rowsOf = (id) => rows.filter((r) => String(r.company_id) === id);

  let payerIndex = ids.length - 1;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (rowsOf(ids[i]).length) {
      payerIndex = i;
      break;
    }
  }
  const payer = chain[payerIndex];
  const governed = ids.slice(0, payerIndex + 1);
  return {
    companyId: ids[0],
    companyName: chain[0].name,
    rootId: ids[ids.length - 1],
    billingCompanyId: payer.id,
    billingCompanyName: payer.name,
    // This company up to the payer: overrides on any of them are read.
    chain: governed,
    billedThroughParent: payerIndex > 0,
    subscription: pickGoverningSubscription(rowsOf(payer.id)),
  };
};

/**
 * True when this company, or a company above it, has a suspended
 * subscription: a subsidiary is locked out with its parent. Used by
 * auth.middleware.js on every request, so it reads only what it needs.
 */
const isBillingSuspended = async (companyId) => {
  if (!companyId) return false;
  const chain = await getCompanyChain(companyId);
  const { data } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id')
    .in('company_id', chain.map((c) => c.id))
    .eq('status', 'suspended')
    .limit(1)
    .maybeSingle();
  return Boolean(data);
};

/** "Your company's" for the payer itself, "Acme Group's" for a subsidiary. */
const payerPossessive = (account) => (account.billedThroughParent
  ? `${account.billingCompanyName || 'Your parent company'}'s`
  : 'Your company\'s');

/** Tests only. */
const clearBillingCache = () => chainCache.clear();

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * couponCode is optional and additive — every existing caller (e.g.
 * subscriptionAdminController.create, which passes exactly 5 args) is
 * unaffected; only a caller that explicitly passes a 6th arg engages
 * coupon.service.js's redeemCoupon at all.
 */
/**
 * initialStatus/triggeredBy are additive, defaulting to the exact original
 * behavior ('active' + 'super_admin') — every existing caller (the
 * super-admin "create subscription" flow) passes 5 positional args and is
 * unaffected. Added for item 3's onboarding auto-trial: a fresh signup gets
 * 'trialing' + 'system' instead, and — since a trial hasn't been charged
 * anything yet — no invoice is created at all for that path (a 'pending,
 * due now' invoice would incorrectly demand payment from a brand-new trial).
 */
const createSubscription = async (companyId, planId, billingCycle, seatCount, actorId, couponCode = null, initialStatus = 'active', triggeredBy = 'super_admin') => {
  // A subsidiary is billed through its top parent — it never gets a plan,
  // seats or features of its own.
  const chain = await getCompanyChain(companyId);
  if (chain.length > 1) {
    const top = chain[chain.length - 1];
    throw new BadRequestError(
      `${chain[0].name || 'This company'} is a subsidiary of ${top.name || 'another company'} and uses its plan and seats. Manage billing on ${top.name || 'the parent company'} instead.`,
    );
  }
  const plan = await getPlanOrThrow(planId);
  if (!plan.is_active) throw new BadRequestError('Cannot subscribe to an inactive plan');
  if (plan.max_seats && seatCount > plan.max_seats) {
    throw new BadRequestError(`This plan supports at most ${plan.max_seats} seats`);
  }

  const { data: existingLive } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .in('status', LIVE_STATUSES)
    .maybeSingle();
  if (existingLive) throw new ConflictError('This company already has an active subscription');

  let price = computeCyclePrice(plan, billingCycle, seatCount);
  const couponService = require('./coupon.service');
  const coupon = couponCode ? await couponService.fetchValidCoupon(couponCode, planId) : null;
  if (coupon) price = couponService.applyDiscount(price, coupon);

  const periodStart = new Date().toISOString();
  // A trial runs for TRIAL_DAYS, not a full billing cycle; expireTrials() in
  // subscriptionBilling.cron.js ends it once current_period_end passes.
  const periodEnd = initialStatus === 'trialing'
    ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : cyclePeriodEnd(periodStart, billingCycle);

  const { data: subscription, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .insert({
      company_id: companyId,
      plan_id: planId,
      billing_cycle: billingCycle,
      seat_count: seatCount,
      price_locked_at_signup: price,
      status: initialStatus,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      auto_renew: true,
      next_renewal_date: periodEnd,
    })
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;

  let invoice = null;
  if (initialStatus !== 'trialing') {
    const { data: createdInvoice, error: invoiceError } = await supabaseAdmin
      .from('subscription_invoices')
      .insert({
        company_subscription_id: subscription.id,
        company_id: companyId,
        invoice_number: await nextInvoiceNumber(),
        amount: price,
        currency: 'INR',
        billing_cycle: billingCycle,
        seat_count_at_invoice: seatCount,
        status: 'pending',
        due_at: periodStart,
        line_items: coupon
          ? [
              { type: 'base_subscription', description: `${plan.name} — ${billingCycle}`, amount: computeCyclePrice(plan, billingCycle, seatCount) },
              { type: 'coupon_discount', description: `Coupon ${coupon.code}`, amount: -(computeCyclePrice(plan, billingCycle, seatCount) - price) },
            ]
          : [{ type: 'base_subscription', description: `${plan.name} — ${billingCycle}`, amount: price }],
      })
      .select('*')
      .single();
    if (invoiceError) throw invoiceError;
    invoice = createdInvoice;

    if (coupon) await couponService.recordRedemption(coupon, companyId, invoice.id);
  }

  await logSubscriptionEvent(subscription.id, 'created', triggeredBy, actorId, {
    planId, planCode: plan.code, billingCycle, seatCount, price, couponCode: coupon?.code || null, initialStatus,
  });

  const notifications = require('./subscriptionNotification.service');
  // Not awaited: the action does not wait on email.
  notifications.sendWelcomeNotification(subscription).catch((e) =>
    logger.error('[Subscription] Welcome notification failed', { subscriptionId: subscription.id, error: e.message }));

  return { subscription, invoice };
};

const changeSeats = async (subscriptionId, newSeatCount, actorId) => {
  if (!Number.isInteger(newSeatCount) || newSeatCount < 1) {
    throw new BadRequestError('Seat count must be a positive integer');
  }
  const subscription = await getSubscriptionOrThrow(subscriptionId);
  const plan = subscription.plans;
  if (plan.max_seats && newSeatCount > plan.max_seats) {
    throw new BadRequestError(`This plan supports at most ${plan.max_seats} seats`);
  }
  if (newSeatCount === subscription.seat_count) return subscription;

  const oldCyclePrice = computeCyclePrice(plan, subscription.billing_cycle, subscription.seat_count);
  const newCyclePrice = computeCyclePrice(plan, subscription.billing_cycle, newSeatCount);
  const proration = prorateForRemainder(subscription, oldCyclePrice, newCyclePrice);

  if (proration !== 0) {
    await appendDraftInvoiceLineItem(subscription, {
      type: 'proration_seats',
      description: `Seat change ${subscription.seat_count} → ${newSeatCount} (prorated for remainder of current period)`,
      amount: proration,
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({ seat_count: newSeatCount, price_locked_at_signup: newCyclePrice })
    .eq('id', subscriptionId)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;

  await logSubscriptionEvent(
    subscriptionId,
    newSeatCount > subscription.seat_count ? 'seat_added' : 'seat_removed',
    'super_admin',
    actorId,
    { oldSeatCount: subscription.seat_count, newSeatCount, proration },
  );

  return updated;
};

const changePlan = async (subscriptionId, newPlanId, actorId) => {
  const subscription = await getSubscriptionOrThrow(subscriptionId);
  const oldPlan = subscription.plans;
  const newPlan = await getPlanOrThrow(newPlanId);
  if (!newPlan.is_active) throw new BadRequestError('Cannot switch to an inactive plan');
  if (newPlan.max_seats && subscription.seat_count > newPlan.max_seats) {
    throw new BadRequestError(`The target plan supports at most ${newPlan.max_seats} seats — reduce seats first`);
  }
  if (newPlanId === subscription.plan_id) return subscription;

  const oldCyclePrice = computeCyclePrice(oldPlan, subscription.billing_cycle, subscription.seat_count);
  const newCyclePrice = computeCyclePrice(newPlan, subscription.billing_cycle, subscription.seat_count);
  const proration = prorateForRemainder(subscription, oldCyclePrice, newCyclePrice);
  const isUpgrade = newCyclePrice >= oldCyclePrice;

  if (proration !== 0) {
    await appendDraftInvoiceLineItem(subscription, {
      type: 'proration_plan_change',
      description: `Plan change ${oldPlan.name} → ${newPlan.name} (prorated for remainder of current period)`,
      amount: proration,
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({ plan_id: newPlanId, price_locked_at_signup: newCyclePrice })
    .eq('id', subscriptionId)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;

  await logSubscriptionEvent(subscriptionId, isUpgrade ? 'upgraded' : 'downgraded', 'super_admin', actorId, {
    oldPlanId: oldPlan.id, oldPlanCode: oldPlan.code, newPlanId, newPlanCode: newPlan.code, proration,
  });

  const notifications = require('./subscriptionNotification.service');
  // Not awaited: the action does not wait on email.
  notifications.sendPlanChangedNotification(updated, oldPlan, newPlan).catch((e) =>
    logger.error('[Subscription] Plan-changed notification failed', { subscriptionId, error: e.message }));

  return updated;
};

/** Shared by renewSubscription (auto/manual-pending) and manualRenewSubscription (paid immediately). */
const performRenewal = async (subscription, { triggeredBy, actorId }) => {
  const plan = subscription.plans;
  // Re-locks to the plan's CURRENT price — this is the one moment a plan
  // price edit is allowed to reach an existing subscription, per the spec
  // ("only new subscriptions or explicit renewals at the new price").
  const price = computeCyclePrice(plan, subscription.billing_cycle, subscription.seat_count);
  const periodStart = subscription.current_period_end;
  const periodEnd = cyclePeriodEnd(periodStart, subscription.billing_cycle);

  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({
      status: 'active',
      price_locked_at_signup: price,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      next_renewal_date: periodEnd,
      past_due_since: null,
    })
    .eq('id', subscription.id)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;

  // Reuse/finalize any pending draft invoice (proration from seat/plan
  // changes since the last renewal) rather than creating a second one.
  const { data: draftInvoice } = await supabaseAdmin
    .from('subscription_invoices')
    .select('*')
    .eq('company_subscription_id', subscription.id)
    .eq('status', 'draft')
    .maybeSingle();

  const baseLineItem = { type: 'base_subscription', description: `${plan.name} — ${subscription.billing_cycle} renewal`, amount: price };
  let invoice;
  if (draftInvoice) {
    const lineItems = [...(draftInvoice.line_items || []), baseLineItem];
    const amount = lineItems.reduce((sum, li) => sum + Number(li.amount || 0), 0);
    const { data: finalized, error: finalizeError } = await supabaseAdmin
      .from('subscription_invoices')
      .update({
        line_items: lineItems, amount, status: 'pending',
        seat_count_at_invoice: subscription.seat_count, due_at: periodStart, issued_at: new Date().toISOString(),
      })
      .eq('id', draftInvoice.id)
      .select('*')
      .single();
    if (finalizeError) throw finalizeError;
    invoice = finalized;
  } else {
    const { data: created, error: createError } = await supabaseAdmin
      .from('subscription_invoices')
      .insert({
        company_subscription_id: subscription.id,
        company_id: subscription.company_id,
        invoice_number: await nextInvoiceNumber(),
        amount: price,
        currency: 'INR',
        billing_cycle: subscription.billing_cycle,
        seat_count_at_invoice: subscription.seat_count,
        status: 'pending',
        due_at: periodStart,
        line_items: [baseLineItem],
      })
      .select('*')
      .single();
    if (createError) throw createError;
    invoice = created;
  }

  await logSubscriptionEvent(subscription.id, 'renewed', triggeredBy, actorId || null, {
    price, periodStart, periodEnd, invoiceId: invoice.id,
  });

  return { subscription: updated, invoice };
};

const renewSubscription = async (subscriptionId, actorId, isManual = false) => {
  const subscription = await getSubscriptionOrThrow(subscriptionId);
  const result = await performRenewal(subscription, { triggeredBy: isManual ? 'super_admin' : 'system', actorId });

  const notifications = require('./subscriptionNotification.service');
  // Not awaited: the action does not wait on email.
  notifications.sendRenewedNotification(result.subscription, result.invoice).catch((e) =>
    logger.error('[Subscription] Renewed notification failed', { subscriptionId, error: e.message }));

  return result;
};

/** Manual/offline renewal (cash, bank transfer) — invoice is paid immediately, not left pending. */
const manualRenewSubscription = async (subscriptionId, actorId, paymentReference, note) => {
  if (!paymentReference || !String(paymentReference).trim()) {
    throw new BadRequestError('A payment reference/note is required for a manual renewal');
  }
  const subscription = await getSubscriptionOrThrow(subscriptionId);
  const { subscription: updatedSub, invoice } = await performRenewal(subscription, { triggeredBy: 'super_admin', actorId });

  const { data: paidInvoice, error } = await supabaseAdmin
    .from('subscription_invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_method: 'manual_offline',
      payment_reference: note ? `${paymentReference} — ${note}` : paymentReference,
    })
    .eq('id', invoice.id)
    .select('*')
    .single();
  if (error) throw error;

  const notifications = require('./subscriptionNotification.service');
  // Not awaited: the action does not wait on email.
  notifications.sendRenewedNotification(updatedSub, paidInvoice).catch((e) =>
    logger.error('[Subscription] Renewed notification failed', { subscriptionId, error: e.message }));

  return { subscription: updatedSub, invoice: paidInvoice };
};

const cancelSubscription = async (subscriptionId, actorId, reason, immediate) => {
  const subscription = await getSubscriptionOrThrow(subscriptionId);
  const updates = immediate
    ? { status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason || null, auto_renew: false }
    : { cancel_at_period_end: true, cancellation_reason: reason || null };

  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update(updates)
    .eq('id', subscriptionId)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;

  await logSubscriptionEvent(subscriptionId, 'cancelled', 'super_admin', actorId, {
    reason: reason || null, immediate: Boolean(immediate),
  });

  return updated;
};

const suspendSubscription = async (subscriptionId, actorId, reason) => {
  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({ status: 'suspended' })
    .eq('id', subscriptionId)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;
  if (!updated) throw new NotFoundError('Subscription not found');

  await logSubscriptionEvent(subscriptionId, 'suspended', 'super_admin', actorId, { reason: reason || null, manual: true });

  const notifications = require('./subscriptionNotification.service');
  // Not awaited: the action does not wait on email.
  notifications.sendSuspendedNotification(updated).catch((e) =>
    logger.error('[Subscription] Suspended notification failed', { subscriptionId, error: e.message }));

  return updated;
};

const reactivateSubscription = async (subscriptionId, actorId) => {
  const { data: updated, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({ status: 'active', past_due_since: null })
    .eq('id', subscriptionId)
    .select('*, plans:subscription_plans(*), companies(id, name, slug)')
    .single();
  if (error) throw error;
  if (!updated) throw new NotFoundError('Subscription not found');

  await logSubscriptionEvent(subscriptionId, 'reactivated', 'super_admin', actorId, {});

  return updated;
};

/**
 * Stub — no real payment gateway is wired in (explicitly out of scope for
 * this feature). Returns the same shape a real gateway call would, so the
 * surrounding state machine (auto-renewal, dunning retries) is fully real
 * and gateway-agnostic. Swap the body for a real Razorpay/Stripe charge
 * later without touching any caller of this function.
 */
const chargePaymentMethod = async (subscription, invoice) => {
  // invoice.amount is the base (ex-GST) amount; the customer is charged base + GST.
  const chargeAmount = grossAmount(invoice?.amount);
  logger.info('[Subscription] chargePaymentMethod stub invoked (no gateway wired in)', {
    subscriptionId: subscription.id, invoiceId: invoice?.id, baseAmount: invoice?.amount, chargeAmount,
  });
  return { success: true, gatewayResponse: { stub: true, note: 'No payment gateway wired in yet — stub always succeeds.' } };
};

// ============================================================================
// Seat enforcement
// ============================================================================

const countActiveEmployees = async (companyIds) => {
  const { count, error } = await supabaseAdmin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .in('company_id', companyIds)
    .eq('is_active', true);
  if (error) throw error;
  return count || 0;
};

/**
 * Seats are one pool per group: active employees of the paying company and
 * every subsidiary under it, against the paying company's subscription.
 * Subsidiaries that are switched off still count — their employees are
 * still active and come back the moment the subsidiary is switched on.
 */
const seatUsageFor = async (account) => {
  const groupIds = await getGroupCompanyIds(account.billingCompanyId);
  const subsidiaryIds = groupIds.slice(1);
  const [used, usedInSubsidiaries, ownUsed] = await Promise.all([
    countActiveEmployees(groupIds),
    subsidiaryIds.length ? countActiveEmployees(subsidiaryIds) : 0,
    account.companyId === account.billingCompanyId ? null : countActiveEmployees([account.companyId]),
  ]);

  const subscription = account.subscription && LIVE_STATUSES.includes(account.subscription.status)
    ? account.subscription
    : null;
  // Module 6: a super-admin goodwill/beta seat grant on top of the plan's
  // own seat_count, set via company_feature_overrides' sibling column
  // rather than a full plan change — see featureOverride.service.js.
  const planLimit = subscription ? subscription.seat_count : null;
  const effectiveLimit = subscription?.max_seats_override != null
    ? Math.max(planLimit || 0, subscription.max_seats_override)
    : planLimit;

  return {
    used,
    limit: effectiveLimit,
    planLimit,
    seatOverride: subscription?.max_seats_override ?? null,
    planName: subscription?.plans?.name || null,
    status: subscription?.status || null,
    hasSubscription: Boolean(subscription),
    // Of `used`: how many are in subsidiaries, and how many in this company.
    usedInSubsidiaries,
    subsidiaryCount: subsidiaryIds.length,
    ownUsed: ownUsed == null ? used - usedInSubsidiaries : ownUsed,
    // Set when this company's seats come from a parent company.
    billedThrough: account.billedThroughParent
      ? { id: account.billingCompanyId, name: account.billingCompanyName }
      : null,
  };
};

const getSeatUsage = async (companyId) => seatUsageFor(await getBillingAccount(companyId));

/**
 * Called before an employee becomes active anywhere in a group: hiring
 * (employee.controller.js's create(), which bulk import also goes through),
 * and reactivating or moving an employee. A subsidiary's employees use the
 * top parent's seats, so a group of 25 seats can't hold a 26th employee in
 * any of its companies.
 *
 * fromCompanyId: the employee's current company, when they are being moved.
 * A move inside the same group needs no seat (the group total doesn't
 * change); a move in from outside it does.
 */
const assertSeatAvailable = async (companyId, { fromCompanyId = null } = {}) => {
  const account = await getBillingAccount(companyId);
  if (fromCompanyId) {
    const from = await getBillingAccount(fromCompanyId);
    if (from.billingCompanyId === account.billingCompanyId) return;
  }

  const { subscription } = account;
  // Never billed at all (the default company, or one set up without a plan):
  // not blocked, as before — and its subsidiaries with it.
  if (!subscription) return;
  if (!LIVE_STATUSES.includes(subscription.status)) {
    throw new ConflictError(
      `${payerPossessive(account)} subscription is ${subscription.status}, so no employees can be added. Contact billing to resolve this.`,
    );
  }

  const usage = await seatUsageFor(account);
  if (usage.used < usage.limit) return;
  if (account.billedThroughParent) {
    throw new ConflictError(
      `Seat limit reached (${usage.used}/${usage.limit} on ${account.billingCompanyName}'s ${usage.planName} plan, which this company shares). Increase seats on ${account.billingCompanyName}'s plan to add more employees.`,
    );
  }
  const inSubsidiaries = usage.usedInSubsidiaries
    ? `, including ${usage.usedInSubsidiaries} in subsidiaries`
    : '';
  throw new ConflictError(
    `Seat limit reached (${usage.used}/${usage.limit} on the ${usage.planName} plan${inSubsidiaries}). Increase seats to add more employees.`,
  );
};

module.exports = {
  computeCyclePrice,
  cyclePeriodEnd,
  getPlanOrThrow,
  getSubscriptionOrThrow,
  createSubscription,
  changeSeats,
  changePlan,
  renewSubscription,
  manualRenewSubscription,
  cancelSubscription,
  suspendSubscription,
  reactivateSubscription,
  chargePaymentMethod,
  performRenewal,
  logSubscriptionEvent,
  getSeatUsage,
  assertSeatAvailable,
  getCompanyChain,
  getBillingRoot,
  getBillingAccount,
  getGroupCompanyIds,
  isBillingSuspended,
  clearBillingCache,
  LIVE_STATUSES,
};
