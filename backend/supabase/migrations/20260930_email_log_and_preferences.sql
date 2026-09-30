-- 20260930_email_log_and_preferences.sql
-- 1. email_log — one row per email the platform sends, skips or fails to
--    send, for the super-admin Email Log. Nothing recorded this before:
--    System Health's "email failures" only ever covered subscription email.
-- 2. Widens company_email_preferences so every switchable email in
--    emailCatalog.js can be turned off per company, not just the first 10.

CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Null for platform email (leads, job alerts) that belongs to no company.
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  -- A key from emailCatalog.js, or 'untyped' for a send that bypassed it.
  email_type VARCHAR(60) NOT NULL,
  audience VARCHAR(30),
  recipient VARCHAR(320) NOT NULL,
  -- Subject only, never the body: bodies carry temporary passwords and OTPs.
  subject VARCHAR(300),
  status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'mock', 'failed', 'skipped')),
  -- Why a 'skipped' row was not sent, e.g. 'disabled_for_company'.
  skip_reason VARCHAR(60),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_company_created ON email_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_type ON email_log(email_type);

-- Backend-only (service role); no public policies.
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

-- The CHECK mirrors PREFERENCE_KEYS in emailCatalog.js — adding a switch
-- there needs a matching line here. The inline CHECK from
-- 20260928_company_email_preferences.sql got Postgres's default name.
ALTER TABLE company_email_preferences
  DROP CONSTRAINT IF EXISTS company_email_preferences_category_check;
ALTER TABLE company_email_preferences
  ADD CONSTRAINT company_email_preferences_category_check CHECK (category IN (
    'prejoining_reminder',
    'day_one_welcome',
    'checklist_reminder',
    'onboarding_complete',
    'offboarding',
    'attendance_anomaly_alerts',
    'attendance_anomaly_digest',
    'auto_checkout',
    'regularization',
    'leave_updates',
    'leave_approval_requests',
    'leave_balance_low',
    'payslip',
    'salary_revision',
    'payroll_alerts',
    'pending_approvals_digest',
    'joiner_digest',
    'birthday_wishes',
    'work_anniversary_wishes',
    'recruitment',
    'announcements',
    'training',
    'notification_copies'
  ));
