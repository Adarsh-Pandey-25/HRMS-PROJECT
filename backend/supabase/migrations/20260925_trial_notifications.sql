-- 7-day free trial: allow the trial reminder / trial ended notification
-- types in the billing notification log (used for once-only sends).

ALTER TABLE subscription_notifications_log
  DROP CONSTRAINT IF EXISTS subscription_notifications_log_notification_type_check;

ALTER TABLE subscription_notifications_log
  ADD CONSTRAINT subscription_notifications_log_notification_type_check
  CHECK (notification_type IN (
    'renewal_90d', 'renewal_30d', 'renewal_7d', 'renewal_1d',
    'payment_failed', 'grace_period_started', 'grace_period_ending',
    'suspended', 'welcome', 'plan_changed', 'renewed',
    'trial_ending', 'trial_ended'
  ));
