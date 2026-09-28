-- 20260928_company_email_preferences.sql
-- Per-company opt-out for non-transactional email categories
-- (emailPreferences.service.js). A MISSING row means enabled — the service
-- defaults to true — so this table only ever stores explicit choices.

CREATE TABLE IF NOT EXISTS company_email_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Mirrors ALLOWED_CATEGORIES in emailPreferences.service.js:5-16.
  -- Kept as a CHECK rather than an enum so adding a category is a one-line
  -- constraint swap, matching how the service validates.
  category VARCHAR(50) NOT NULL CHECK (category IN (
    'attendance_anomaly_alerts',
    'attendance_anomaly_digest',
    'birthday_wishes',
    'work_anniversary_wishes',
    'pending_approvals_digest',
    'joiner_digest',
    'prejoining_reminder',
    'day_one_welcome',
    'checklist_reminder',
    'leave_balance_low'
  )),
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Super-admin who last changed it (the routes sit behind super-admin auth).
  updated_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- REQUIRED by the upsert's onConflict: 'company_id,category'
-- (emailPreferences.service.js:129). Without this the upsert fails even
-- once the table exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_email_preferences_company_category
  ON company_email_preferences(company_id, category);

CREATE INDEX IF NOT EXISTS idx_company_email_preferences_company
  ON company_email_preferences(company_id);

DROP TRIGGER IF EXISTS trg_company_email_preferences_updated ON company_email_preferences;
CREATE TRIGGER trg_company_email_preferences_updated
  BEFORE UPDATE ON company_email_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backend-only (service role); no public policies.
ALTER TABLE company_email_preferences ENABLE ROW LEVEL SECURITY;
