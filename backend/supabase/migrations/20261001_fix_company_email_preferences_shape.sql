-- 20261001_fix_company_email_preferences_shape.sql
-- Production's company_email_preferences was created before 20260928, with
-- a different shape (no id, no created_at, and constraints that could not be
-- inspected). 20260928's CREATE TABLE IF NOT EXISTS therefore left it as it
-- was, and saving an email switch failed against it.
--
-- This puts the table into the exact shape the code expects:
--   - already that shape (has an id column) -> nothing is changed;
--   - another shape and EMPTY               -> dropped and recreated;
--   - another shape WITH rows               -> refuses, so nothing is lost.
-- Safe to run more than once. One transaction: if the refusal fires,
-- nothing at all is applied, whichever SQL client runs it.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.company_email_preferences') IS NULL THEN
    RETURN; -- not there at all: the CREATE below makes it
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'company_email_preferences' AND column_name = 'id'
  ) THEN
    RETURN; -- already the expected shape
  END IF;
  IF (SELECT count(*) FROM public.company_email_preferences) > 0 THEN
    RAISE EXCEPTION 'company_email_preferences has rows and an unexpected shape — not recreating it. Nothing was changed.';
  END IF;
  DROP TABLE public.company_email_preferences;
END $$;

CREATE TABLE IF NOT EXISTS company_email_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Super admin who last changed it (the routes sit behind super-admin auth).
  updated_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_email_preferences_company_category
  ON company_email_preferences(company_id, category);
CREATE INDEX IF NOT EXISTS idx_company_email_preferences_company
  ON company_email_preferences(company_id);

DROP TRIGGER IF EXISTS trg_company_email_preferences_updated ON company_email_preferences;
CREATE TRIGGER trg_company_email_preferences_updated
  BEFORE UPDATE ON company_email_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE company_email_preferences ENABLE ROW LEVEL SECURITY;

-- Every switch in emailCatalog.js PREFERENCE_KEYS (as in 20260930).
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

COMMIT;
