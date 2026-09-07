const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const emailService = require('./email.service');

/**
 * No billing-contact-email column exists anywhere in the data model (see
 * the companies table — just name/slug/is_active). Recipients default to
 * this company's active admins. Assumption, flagged: adjust if the business
 * wants a dedicated billing contact field on `companies` instead/as well.
 */
const getRecipients = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('email, first_name')
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .eq('is_active', true);
  if (error) {
    logger.error('[SubscriptionNotify] Failed to resolve recipients', { companyId, error: error.message });
    return [];
  }
  return data || [];
};

/** Log every send (or attempted send) so cron reminders can dedup against it. */
const logNotification = async (subscriptionId, notificationType, sentTo, deliveryStatus) => {
  const { error } = await supabaseAdmin.from('subscription_notifications_log').insert({
    company_subscription_id: subscriptionId,
    notification_type: notificationType,
    sent_to: sentTo,
    delivery_status: deliveryStatus,
  });
  if (error) logger.error('[SubscriptionNotify] Failed to log notification', { subscriptionId, notificationType, error: error.message });
};

/** Already sent this notification_type for this subscription today — reminder crons call this before sending. */
const alreadySentToday = async (subscriptionId, notificationType) => {
  const startOfDay = moment().startOf('day').toISOString();
  const { data, error } = await supabaseAdmin
    .from('subscription_notifications_log')
    .select('id')
    .eq('company_subscription_id', subscriptionId)
    .eq('notification_type', notificationType)
    .gte('sent_at', startOfDay)
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error('[SubscriptionNotify] Dedup check failed — assuming not sent', { subscriptionId, notificationType, error: error.message });
    return false;
  }
  return Boolean(data);
};

const sendToAllRecipients = async (companyId, subscriptionId, notificationType, sendFn) => {
  const recipients = await getRecipients(companyId);
  if (!recipients.length) {
    logger.warn('[SubscriptionNotify] No admin recipients found', { companyId, subscriptionId, notificationType });
    return;
  }
  await Promise.all(recipients.map(async (r) => {
    try {
      await sendFn({ to: r.email, name: r.first_name });
      await logNotification(subscriptionId, notificationType, r.email, 'sent');
    } catch (err) {
      logger.error('[SubscriptionNotify] Send failed', { companyId, subscriptionId, notificationType, to: r.email, error: err.message });
      await logNotification(subscriptionId, notificationType, r.email, 'failed');
    }
  }));
};

const sendWelcomeNotification = (subscription) =>
  sendToAllRecipients(subscription.company_id, subscription.id, 'welcome', (recipient) =>
    emailService.subscriptionWelcomeEmail(recipient, subscription, subscription.plans));

const sendRenewedNotification = (subscription, invoice) =>
  sendToAllRecipients(subscription.company_id, subscription.id, 'renewed', (recipient) =>
    emailService.subscriptionRenewedEmail(recipient, subscription, invoice));

const sendPlanChangedNotification = (subscription, oldPlan, newPlan) =>
  sendToAllRecipients(subscription.company_id, subscription.id, 'plan_changed', (recipient) =>
    emailService.subscriptionPlanChangedEmail(recipient, subscription, oldPlan, newPlan));

const sendRenewalReminderNotification = (subscription, notificationType) =>
  sendToAllRecipients(subscription.company_id, subscription.id, notificationType, (recipient) => {
    const subscriptionService = require('./subscription.service');
    const price = subscriptionService.computeCyclePrice(subscription.plans, subscription.billing_cycle, subscription.seat_count);
    return emailService.subscriptionRenewalReminderEmail(recipient, subscription, subscription.plans, price, notificationType);
  });

const sendPaymentFailedNotification = (subscription, reason, graceDays) =>
  sendToAllRecipients(subscription.company_id, subscription.id, 'payment_failed', (recipient) =>
    emailService.subscriptionPaymentFailedEmail(recipient, subscription, reason, graceDays));

const sendGracePeriodEndingNotification = (subscription, daysLeft) =>
  sendToAllRecipients(subscription.company_id, subscription.id, 'grace_period_ending', (recipient) =>
    emailService.subscriptionGracePeriodEndingEmail(recipient, subscription, daysLeft));

const sendSuspendedNotification = (subscription) =>
  sendToAllRecipients(subscription.company_id, subscription.id, 'suspended', (recipient) =>
    emailService.subscriptionSuspendedEmail(recipient, subscription));

module.exports = {
  getRecipients,
  logNotification,
  alreadySentToday,
  sendWelcomeNotification,
  sendRenewedNotification,
  sendPlanChangedNotification,
  sendRenewalReminderNotification,
  sendPaymentFailedNotification,
  sendGracePeriodEndingNotification,
  sendSuspendedNotification,
};
