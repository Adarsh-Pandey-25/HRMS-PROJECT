-- =============================================================================
-- Super Admin console — bugfixes + manual invoice / extend subscription /
-- feature registry / export gating (follow-up to 20260911_super_admin_console.sql)
-- =============================================================================

-- Item 4: "Extend Subscription" needs a new subscription_events event_type
-- that the original CHECK constraint doesn't allow. Dynamic constraint-name
-- lookup (same pattern already used elsewhere in this file for
-- employee_career_events) since the auto-generated name isn't guaranteed
-- across environments.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'subscription_events'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE subscription_events DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE subscription_events ADD CONSTRAINT subscription_events_event_type_check
    CHECK (event_type IN (
      'created', 'renewed', 'upgraded', 'downgraded', 'seat_added', 'seat_removed',
      'payment_failed', 'payment_recovered', 'suspended', 'reactivated', 'cancelled', 'expired',
      'manual_extension'
    ));
END $$;

-- Item 6: per-company override to allow bulk data export despite a
-- non-active/trialing subscription status — a deliberate, explicit,
-- separately-logged super-admin action (never a side-effect of a credit
-- or extension, which only ever touch amount-owed / renewal-date).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS export_override_enabled BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN companies.export_override_enabled IS
  'Super-admin-only goodwill override: allows bulk data export even when the subscription status would normally block it. Set only via an explicit, audited super-admin action.';
