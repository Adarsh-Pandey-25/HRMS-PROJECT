const cron = require('node-cron');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const subscriptionService = require('../services/subscription.service');
const notifications = require('../services/subscriptionNotification.service');

const REMINDER_THRESHOLDS = [
  { days: 90, type: 'renewal_90d' },
  { days: 30, type: 'renewal_30d' },
  { days: 7, type: 'renewal_7d' },
  { days: 1, type: 'renewal_1d' },
];

const getGraceDays = async () => {
  const settingsService = require('../services/settings.service');
  return settingsService.getNumber('subscription_grace_period_days', 7, null);
};

/**
 * Auto-renewal: subscriptions due today with auto_renew on. Charges via the
 * stubbed chargePaymentMethod() BEFORE committing anything (no invoice/
 * period-extension exists yet at charge time) so a failed charge leaves the
 * subscription completely untouched except for the past_due transition
 * below — nothing to roll back.
 */
const runAutoRenewals = async () => {
  const today = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*), companies(id, name)')
    .eq('status', 'active')
    .eq('auto_renew', true)
    .lte('next_renewal_date', today);
  if (error) throw error;

  let renewed = 0;
  let failed = 0;

  for (const subscription of due || []) {
    const price = subscriptionService.computeCyclePrice(subscription.plans, subscription.billing_cycle, subscription.seat_count);
    const chargeResult = await subscriptionService.chargePaymentMethod(subscription, { amount: price }).catch((e) => ({ success: false, reason: e.message }));

    if (chargeResult.success) {
      const { subscription: renewedSub, invoice } = await subscriptionService.performRenewal(subscription, { triggeredBy: 'system' });
      await supabaseAdmin
        .from('subscription_invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: 'auto' })
        .eq('id', invoice.id);
      await supabaseAdmin.from('subscription_payment_attempts').insert({
        subscription_invoice_id: invoice.id, attempt_number: 1, status: 'success', gateway_response: chargeResult.gatewayResponse,
      });
      await notifications.sendRenewedNotification(renewedSub, invoice).catch(() => {});
      renewed += 1;
    } else {
      await markPaymentFailed(subscription, price, chargeResult, 1);
      failed += 1;
    }
  }

  return { renewed, failed };
};

const markPaymentFailed = async (subscription, price, chargeResult, attemptNumber) => {
  const graceDays = await getGraceDays();
  const isFirstFailure = subscription.status === 'active';

  if (isFirstFailure) {
    await supabaseAdmin
      .from('company_billing_subscriptions')
      .update({ status: 'past_due', past_due_since: new Date().toISOString() })
      .eq('id', subscription.id);
  }

  const { data: invoice, error } = await supabaseAdmin
    .from('subscription_invoices')
    .insert({
      company_subscription_id: subscription.id,
      company_id: subscription.company_id,
      invoice_number: `INV-${moment().format('YYYYMMDD')}-${subscription.id.slice(0, 8).toUpperCase()}`,
      amount: price,
      currency: 'INR',
      billing_cycle: subscription.billing_cycle,
      seat_count_at_invoice: subscription.seat_count,
      status: 'failed',
      due_at: subscription.next_renewal_date,
      line_items: [{ type: 'base_subscription', description: `${subscription.plans.name} — ${subscription.billing_cycle} renewal (payment failed)`, amount: price }],
    })
    .select('id')
    .single();
  if (error) {
    logger.error('[SubscriptionBilling] Failed to record failed-payment invoice', { subscriptionId: subscription.id, error: error.message });
  } else {
    await supabaseAdmin.from('subscription_payment_attempts').insert({
      subscription_invoice_id: invoice.id, attempt_number: attemptNumber, status: 'failed',
      failure_reason: chargeResult.reason || 'Payment declined', gateway_response: chargeResult.gatewayResponse || null,
    });
  }

  await subscriptionService.logSubscriptionEvent(subscription.id, 'payment_failed', 'system', null, {
    reason: chargeResult.reason || 'Payment declined', attemptedPrice: price, attemptNumber,
  });

  if (isFirstFailure) {
    await notifications.sendPaymentFailedNotification(subscription, chargeResult.reason || 'Payment declined', graceDays).catch(() => {});
  }
};

/**
 * Dunning retries at day 1/3/7 of the grace window (from past_due_since) —
 * re-attempts chargePaymentMethod() for subscriptions still past_due/
 * grace_period. A dedup check against subscription_payment_attempts avoids
 * re-retrying the same day if the cron runs more than once.
 */
const DUNNING_RETRY_DAYS = [1, 3, 7];

const runDunningRetries = async () => {
  const { data: pastDue, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*), companies(id, name)')
    .in('status', ['past_due', 'grace_period']);
  if (error) throw error;

  let recovered = 0;
  let retried = 0;

  for (const subscription of pastDue || []) {
    if (!subscription.past_due_since) continue;
    const daysSince = moment().diff(moment(subscription.past_due_since), 'days');
    if (!DUNNING_RETRY_DAYS.includes(daysSince)) continue;

    const { data: existingAttemptToday } = await supabaseAdmin
      .from('subscription_payment_attempts')
      .select('id, subscription_invoices!inner(company_subscription_id)')
      .eq('subscription_invoices.company_subscription_id', subscription.id)
      .gte('attempted_at', moment().startOf('day').toISOString());
    if (existingAttemptToday?.length) continue; // already retried today

    const price = subscriptionService.computeCyclePrice(subscription.plans, subscription.billing_cycle, subscription.seat_count);
    const chargeResult = await subscriptionService.chargePaymentMethod(subscription, { amount: price }).catch((e) => ({ success: false, reason: e.message }));
    retried += 1;

    if (chargeResult.success) {
      const { subscription: renewedSub, invoice } = await subscriptionService.performRenewal(subscription, { triggeredBy: 'system' });
      await supabaseAdmin
        .from('subscription_invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: 'auto' })
        .eq('id', invoice.id);
      await supabaseAdmin.from('subscription_payment_attempts').insert({
        subscription_invoice_id: invoice.id, attempt_number: DUNNING_RETRY_DAYS.indexOf(daysSince) + 2, status: 'success', gateway_response: chargeResult.gatewayResponse,
      });
      await subscriptionService.logSubscriptionEvent(subscription.id, 'payment_recovered', 'system', null, { daysSince, price });
      await notifications.sendRenewedNotification(renewedSub, invoice).catch(() => {});
      recovered += 1;
    } else {
      await markPaymentFailed(subscription, price, chargeResult, DUNNING_RETRY_DAYS.indexOf(daysSince) + 2);
    }
  }

  return { retried, recovered };
};

/**
 * State machine while past due: past_due (0..grace/2 days) -> grace_period
 * (grace/2..grace days), with a "grace period ending" warning 1 day before
 * suspension, -> suspended (after the full grace window). Both past_due and
 * grace_period are distinct statuses in the schema; using the midpoint to
 * separate them gives each state a real meaning instead of grace_period
 * going unused.
 */
const runGracePeriodSweep = async () => {
  const graceDays = await getGraceDays();
  const midpoint = Math.max(1, Math.floor(graceDays / 2));
  const midpointCutoff = moment().subtract(midpoint, 'days').toISOString();
  const graceEndCutoff = moment().subtract(graceDays, 'days').toISOString();
  const warningCutoff = moment().subtract(graceDays - 1, 'days').toISOString();

  let movedToGrace = 0;
  let suspended = 0;
  let warned = 0;

  const { data: enteringGrace, error: e1 } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*), companies(id, name)')
    .eq('status', 'past_due')
    .lte('past_due_since', midpointCutoff);
  if (e1) throw e1;
  for (const s of enteringGrace || []) {
    await supabaseAdmin.from('company_billing_subscriptions').update({ status: 'grace_period' }).eq('id', s.id);
    movedToGrace += 1;
  }

  const { data: warningDue, error: e2 } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*), companies(id, name)')
    .eq('status', 'grace_period')
    .lte('past_due_since', warningCutoff)
    .gt('past_due_since', graceEndCutoff);
  if (e2) throw e2;
  for (const s of warningDue || []) {
    if (await notifications.alreadySentToday(s.id, 'grace_period_ending')) continue;
    await notifications.sendGracePeriodEndingNotification(s, 1).catch(() => {});
    warned += 1;
  }

  const { data: expiring, error: e3 } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('*, plans:subscription_plans(*), companies(id, name)')
    .eq('status', 'grace_period')
    .lte('past_due_since', graceEndCutoff);
  if (e3) throw e3;
  for (const s of expiring || []) {
    await supabaseAdmin.from('company_billing_subscriptions').update({ status: 'suspended' }).eq('id', s.id);
    await subscriptionService.logSubscriptionEvent(s.id, 'suspended', 'system', null, { reason: 'grace_period_elapsed', graceDays });
    await notifications.sendSuspendedNotification(s).catch(() => {});
    suspended += 1;
  }

  return { movedToGrace, warned, suspended, graceDays };
};

/** Applies a non-immediate cancellation (cancel_at_period_end) once the period actually ends, and expires anything else that ran out with no renewal path. */
const runExpirySweep = async () => {
  const now = new Date().toISOString();
  const { data: lapsed, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id')
    .in('status', ['active', 'past_due', 'grace_period'])
    .lt('current_period_end', now)
    .or('cancel_at_period_end.eq.true,auto_renew.eq.false');
  if (error) throw error;

  for (const s of lapsed || []) {
    await supabaseAdmin.from('company_billing_subscriptions').update({ status: 'expired' }).eq('id', s.id);
    await subscriptionService.logSubscriptionEvent(s.id, 'expired', 'system', null, {});
  }
  return { expired: (lapsed || []).length };
};

const runRenewalReminders = async () => {
  let sent = 0;
  for (const { days, type } of REMINDER_THRESHOLDS) {
    const targetDay = moment().add(days, 'days');
    const dayStart = targetDay.clone().startOf('day').toISOString();
    const dayEnd = targetDay.clone().endOf('day').toISOString();

    const { data: subs, error } = await supabaseAdmin
      .from('company_billing_subscriptions')
      .select('*, plans:subscription_plans(*), companies(id, name)')
      .eq('status', 'active')
      .gte('next_renewal_date', dayStart)
      .lte('next_renewal_date', dayEnd);
    if (error) throw error;

    for (const s of subs || []) {
      if (await notifications.alreadySentToday(s.id, type)) continue;
      await notifications.sendRenewalReminderNotification(s, type).catch(() => {});
      sent += 1;
    }
  }
  return { sent };
};

const runSubscriptionBilling = withCronLock('subscription_billing', 10 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running subscription billing (${reason})`);
  const results = {};
  try {
    results.autoRenewals = await runAutoRenewals();
  } catch (err) {
    logger.error('[SubscriptionBilling] Auto-renewal step failed', { error: err.message });
    results.autoRenewalsError = err.message;
  }
  try {
    results.dunning = await runDunningRetries();
  } catch (err) {
    logger.error('[SubscriptionBilling] Dunning step failed', { error: err.message });
    results.dunningError = err.message;
  }
  try {
    results.gracePeriod = await runGracePeriodSweep();
  } catch (err) {
    logger.error('[SubscriptionBilling] Grace-period sweep failed', { error: err.message });
    results.gracePeriodError = err.message;
  }
  try {
    results.expiry = await runExpirySweep();
  } catch (err) {
    logger.error('[SubscriptionBilling] Expiry sweep failed', { error: err.message });
    results.expiryError = err.message;
  }
  try {
    results.reminders = await runRenewalReminders();
  } catch (err) {
    logger.error('[SubscriptionBilling] Renewal reminders failed', { error: err.message });
    results.remindersError = err.message;
  }

  const hasFailure = Object.keys(results).some((k) => k.endsWith('Error'));
  if (hasFailure) {
    await alertOnCronFailure('subscriptionBilling', JSON.stringify(results)).catch((e) => {
      logger.error('[CRON] alertOnCronFailure itself failed', { job: 'subscriptionBilling', error: e.message });
    });
  }

  logger.info('Subscription billing completed', { reason, ...results });
  return results;
});

const startSubscriptionBillingCron = () => {
  runSubscriptionBilling('startup').catch(() => {});

  cron.schedule('30 5 * * *', () => runSubscriptionBilling('cron'), { timezone: config.timezone });

  // Fallback: re-check every 2 hours in case node-cron misses a fire.
  setInterval(() => runSubscriptionBilling('interval'), 2 * 60 * 60 * 1000);

  logger.info(`Subscription billing cron scheduled for 5:30 AM ${config.timezone}`);
};

module.exports = { startSubscriptionBillingCron, runSubscriptionBilling, runAutoRenewals, runDunningRetries, runGracePeriodSweep, runExpirySweep, runRenewalReminders };
