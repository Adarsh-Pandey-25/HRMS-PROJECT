-- =============================================================================
-- Item 5: schema_migrations tracking — System Health has had no real way to
-- report "last migration applied" because nothing recorded when a migration
-- actually ran (migrations here are applied manually against Supabase, no
-- automated runner exists to hook into). Going forward, the convention is:
-- every NEW migration file ends with an INSERT into this table for itself
-- (see the bottom of this very file) — that's what makes an entry
-- `verified = true`. The rows seeded below are a best-effort backfill for
-- every migration file already known (from COMPLETE_DATABASE_SETUP.sql's
-- running section list) to have been applied BEFORE this table existed —
-- `verified = false`, `applied_at` approximated from each filename's own
-- date prefix (or NOW() for the handful of legacy files with no date
-- prefix). Treat this baseline as approximate, not audit-grade.
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- true only for a row inserted by its own migration file at real apply
  -- time; false for the backfilled baseline below, so System Health can
  -- show honestly which entries are real records vs approximated history.
  verified BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);

INSERT INTO schema_migrations (filename, applied_at, verified) VALUES
  ('20260720_saas_phase1_companies_employees.sql', '2026-07-20T00:00:00Z', false),
  ('20260720_saas_phase2_tenant_columns.sql', '2026-07-20T00:00:00Z', false),
  ('20260720_course_enrollment_archive.sql', '2026-07-20T00:00:00Z', false),
  ('20260721_employee_code_per_company.sql', '2026-07-21T00:00:00Z', false),
  ('20260723_api_keys.sql', '2026-07-23T00:00:00Z', false),
  ('20260723_company_hierarchy.sql', '2026-07-23T00:00:00Z', false),
  ('20260723_employee_code_emp001.sql', '2026-07-23T00:00:00Z', false),
  ('20260817_super_admin_onboarding_invites.sql', '2026-08-17T00:00:00Z', false),
  ('20260820_must_change_password.sql', '2026-08-20T00:00:00Z', false),
  ('20260821_adms_device_punches.sql', '2026-08-21T00:00:00Z', false),
  ('20260821_device_employee_mapping.sql', '2026-08-21T00:00:00Z', false),
  ('20260821_device_heartbeats_company.sql', '2026-08-21T00:00:00Z', false),
  ('20260821_device_heartbeats_registry.sql', '2026-08-21T00:00:00Z', false),
  ('20260825_device_punches_scope_dedup_by_device.sql', '2026-08-25T00:00:00Z', false),
  ('20260826_course_enrollment_deadline.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_documents_company_id.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_employee_career_events.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_employee_email_per_company.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_onboarding_checklist.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_onboarding_invite_slug.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_recruitment_richer_fields.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_reimbursement_accommodation_type.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_super_admin_refresh_tokens.sql', '2026-08-26T00:00:00Z', false),
  ('20260827_kb_categories_per_company.sql', '2026-08-27T00:00:00Z', false),
  ('20260828_adms_device_secret.sql', '2026-08-28T00:00:00Z', false),
  ('20260828_tenant_backstop_rls.sql', '2026-08-28T00:00:00Z', false),
  ('20260829_api_keys_revoked_by.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_attendance_audit_columns.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_attendance_composite_index.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_career_events_bank_change_type.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_company_id_not_null.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_cron_locks.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_drop_employees_device_user_id.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_fix_mapping_lookup_index_order.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_kb_categories_backfill_safety.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_payroll_publish_audit.sql', '2026-08-29T00:00:00Z', false),
  ('20260830_course_enrollments_unique.sql', '2026-08-30T00:00:00Z', false),
  ('20260830_drop_leave_balance_trigger.sql', '2026-08-30T00:00:00Z', false),
  ('20260830_employee_token_version.sql', '2026-08-30T00:00:00Z', false),
  ('20260831_purge_stale_device_mappings.sql', '2026-08-31T00:00:00Z', false),
  ('20260901_subscription_billing.sql', '2026-09-01T00:00:00Z', false),
  ('20260902_employee_offboarding.sql', '2026-09-02T00:00:00Z', false),
  ('20260903_install_prompt_seen.sql', '2026-09-03T00:00:00Z', false),
  ('20260904_profile_self_edit_lock.sql', '2026-09-04T00:00:00Z', false),
  ('20260905_onboarding_checklist_bank_details.sql', '2026-09-05T00:00:00Z', false),
  ('20260906_course_enrollment_assigned_by.sql', '2026-09-06T00:00:00Z', false),
  ('20260907_attendance_anomaly_alerts.sql', '2026-09-07T00:00:00Z', false),
  ('20260908_audit_logs.sql', '2026-09-08T00:00:00Z', false),
  ('20260909_backup_logs.sql', '2026-09-09T00:00:00Z', false),
  ('20260910_temp_password_expiry.sql', '2026-09-10T00:00:00Z', false),
  ('20260911_super_admin_console.sql', '2026-09-11T00:00:00Z', false),
  ('20260912_super_admin_console_fixes.sql', '2026-09-12T00:00:00Z', false),
  ('20260913_beacons_geofence_billing_gating.sql', '2026-09-13T00:00:00Z', false),
  ('20260914_manual_payment_recording.sql', '2026-09-14T00:00:00Z', false),
  ('add_attendance_mode.sql', NOW(), false),
  ('add_attendance_status_wfh.sql', NOW(), false),
  ('create_lms_tables.sql', NOW(), false),
  ('create_wfh_day_requests.sql', NOW(), false)
ON CONFLICT (filename) DO NOTHING;

-- This migration registers itself for real — the first `verified = true` row.
INSERT INTO schema_migrations (filename, verified)
  VALUES ('20260915_schema_migrations_tracking.sql', true)
  ON CONFLICT (filename) DO NOTHING;
