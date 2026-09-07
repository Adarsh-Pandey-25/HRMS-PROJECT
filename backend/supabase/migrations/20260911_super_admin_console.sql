-- =============================================================================
-- Super Admin operations console — Modules 1-7
-- =============================================================================
-- Phase 0 findings this migration acts on:
--  * super_admins is already a real table (not a single hardcoded account) —
--    this EXTENDS it with role + 2FA columns rather than replacing anything.
--  * employee_audit_logs.actor_id is FK'd to employees(id), so a super_admin's
--    id cannot be stored there directly — actor_type + super_admin_actor_id
--    extend the existing table (per the spec's own suggestion) instead of a
--    second audit mechanism.
--  * cron_locks only tracks a currently-held lock (row is deleted on release),
--    so it cannot answer "when did each cron last run and did it succeed" —
--    cron_run_log is a genuinely new history table, written by the existing
--    withCronLock wrapper itself (one call site), not by each cron job.
--  * No impersonation / feature-override / internal-notes / coupon mechanism
--    existed anywhere in this codebase before this migration (confirmed by
--    grep) — all net new.
-- =============================================================================

-- ── Module 5: Super-admin roles + mandatory 2FA for full_admin ─────────────
ALTER TABLE super_admins
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'full_admin'
    CHECK (role IN ('full_admin', 'billing_admin', 'support_admin')),
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL;

COMMENT ON COLUMN super_admins.two_factor_secret IS 'AES-256-GCM encrypted TOTP secret (see utils/totp.js) — never stored plaintext.';
COMMENT ON COLUMN super_admins.two_factor_pending_secret IS 'Encrypted secret awaiting confirmation via a real 6-digit code before two_factor_enabled flips true.';

-- ── Module 2: Company profile fields the real detail page needs ────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS industry VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_size VARCHAR(20);

CREATE TABLE IF NOT EXISTS company_internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_internal_notes_company ON company_internal_notes(company_id, created_at DESC);
COMMENT ON TABLE company_internal_notes IS 'Support/ops notes — internal only, never exposed to the company''s own users.';

-- ── Module 5/existing audit trail: attribute super-admin actions ───────────
ALTER TABLE employee_audit_logs
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'employee'
    CHECK (actor_type IN ('employee', 'super_admin', 'system')),
  ADD COLUMN IF NOT EXISTS super_admin_actor_id UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_impersonated BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_employee_audit_logs_super_admin_actor ON employee_audit_logs(super_admin_actor_id) WHERE super_admin_actor_id IS NOT NULL;

-- ── Module 4: Impersonation ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  ip_address VARCHAR(64),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_active ON impersonation_sessions(target_employee_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_company ON impersonation_sessions(company_id, started_at DESC);

-- ── Module 7: real cron run history (cron_locks alone can't answer this) ───
CREATE TABLE IF NOT EXISTS cron_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_run_log_job_finished ON cron_run_log(job_name, finished_at DESC);

-- ── Module 3: Coupons ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value DECIMAL(12,2) NOT NULL CHECK (discount_value > 0),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  max_redemptions INTEGER,
  times_redeemed INTEGER NOT NULL DEFAULT 0,
  applicable_plan_ids JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_to_invoice_id UUID REFERENCES subscription_invoices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_company ON company_coupon_redemptions(company_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON company_coupon_redemptions(coupon_id);

-- ── Module 6: Per-company feature overrides + seat override ────────────────
CREATE TABLE IF NOT EXISTS company_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  reason TEXT,
  set_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_company_feature_overrides_company ON company_feature_overrides(company_id);

ALTER TABLE company_billing_subscriptions
  ADD COLUMN IF NOT EXISTS max_seats_override INTEGER;
COMMENT ON COLUMN company_billing_subscriptions.max_seats_override IS 'Super-admin goodwill/beta seat grant on top of the plan''s seat_count, without a full plan change.';

-- Module 5: admin-user management (create/deactivate/reassign role) is a
-- platform-level action with no company it belongs to — employee_audit_logs
-- required company_id NOT NULL because every action logged until now was
-- inherently company-scoped. Relaxed here (not removed — every existing
-- and new company-scoped call site still always supplies one) so these
-- platform-level actions can flow into the same table per the "reuse
-- audit_logs, extend rather than build a second mechanism" instruction,
-- instead of silently going unlogged. These rows are intentionally
-- invisible to listAuditLogs()'s per-company view (which still requires
-- company_id — see superAdmin.controller.js's Item 5 comment).
ALTER TABLE employee_audit_logs ALTER COLUMN company_id DROP NOT NULL;
