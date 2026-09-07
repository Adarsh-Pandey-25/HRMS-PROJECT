-- =============================================================================
-- Entitlement-gated check-in methods (IP beacon system + GPS geofencing),
-- tenant billing self-service, and strict feature-disable data handling.
-- =============================================================================
-- Section 0 finding: ip_whitelist did NOT exist as a table before this
-- migration — "IP-based Web check-in" was a cosmetic Settings UI writing to
-- a system_settings JSON blob that no backend code ever read. This creates
-- the real table and is the first genuine enforcement point.

CREATE TABLE IF NOT EXISTS ip_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cidr TEXT NOT NULL, -- bare IP or CIDR notation — see utils/helpers.js's ipInCidr
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ip_whitelist_company ON ip_whitelist(company_id) WHERE is_active = true;

-- ── Section D: per-tenant, multi-branch IP-push beacon system ──────────────
CREATE TABLE IF NOT EXISTS ip_beacons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  beacon_key TEXT UNIQUE NOT NULL,
  beacon_secret_hash TEXT NOT NULL, -- SHA-256 hex, apiKey.service.js's hashKey() convention — device_secret's plain-text compare is NOT replicated here
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_whitelist_entry_id UUID REFERENCES ip_whitelist(id) ON DELETE SET NULL,
  expected_region TEXT,
  last_pushed_ip TEXT,
  last_pushed_at TIMESTAMPTZ,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES employees(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_beacons_company ON ip_beacons(company_id);
-- beacon_key alone must resolve a row without leaking which company it's
-- for until the secret is verified — no separate company_id-scoped lookup
-- path exists at ping time, matching the isolation rigor requested.

CREATE TABLE IF NOT EXISTS ip_beacon_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES ip_beacons(id) ON DELETE CASCADE,
  observed_ip TEXT NOT NULL,
  ip_changed BOOLEAN NOT NULL DEFAULT false,
  pinged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- CHECK A's rolling 5h window query is beacon_id + ip_changed + pinged_at.
CREATE INDEX IF NOT EXISTS idx_ip_beacon_pings_beacon_time ON ip_beacon_pings(beacon_id, pinged_at DESC);

CREATE TABLE IF NOT EXISTS ip_beacon_pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES ip_beacons(id) ON DELETE CASCADE,
  proposed_ip TEXT NOT NULL,
  detected_region TEXT,
  reason TEXT NOT NULL DEFAULT 'geo_mismatch' CHECK (reason IN ('geo_mismatch')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES employees(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_beacon_pending_approvals_beacon ON ip_beacon_pending_approvals(beacon_id) WHERE status = 'pending';

-- ── Section E: GPS geofencing ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  center_latitude DOUBLE PRECISION NOT NULL CHECK (center_latitude BETWEEN -90 AND 90),
  center_longitude DOUBLE PRECISION NOT NULL CHECK (center_longitude BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (radius_meters BETWEEN 20 AND 2000),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geofences_company ON geofences(company_id) WHERE is_active = true;

-- ── Section F: tenant billing self-service ──────────────────────────────
CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  requested_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feature_requests_company ON feature_requests(company_id, created_at DESC);

-- Self-serve change-plan/seats/cycle requests, held pending until the
-- (not-yet-built) payment gateway lands and a human completes them —
-- not modeled in subscription_events since that table describes things
-- that already happened to a subscription, not a request awaiting action.
CREATE TABLE IF NOT EXISTS subscription_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_subscription_id UUID REFERENCES company_billing_subscriptions(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('plan', 'seats', 'billing_cycle', 'cancel')),
  requested_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'completed', 'cancelled')),
  requested_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES super_admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_change_requests_company ON subscription_change_requests(company_id, created_at DESC);

-- ── Section G: strict feature-disable data handling ─────────────────────
ALTER TABLE company_feature_overrides
  ADD COLUMN IF NOT EXISTS data_collection_mode TEXT NOT NULL DEFAULT 'continue'
    CHECK (data_collection_mode IN ('continue', 'stop'));
-- Overrides today are per (company_id, feature_key) — visibility (`enabled`)
-- and data_collection_mode are two INDEPENDENT columns on the SAME row by
-- design (Section G's "two separate, independent controls"), not a second
-- table, reusing the existing UNIQUE(company_id, feature_key) row.

CREATE TABLE IF NOT EXISTS adms_discarded_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_serial TEXT NOT NULL,
  raw_punch_data JSONB NOT NULL,
  discarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adms_discarded_punches_purge ON adms_discarded_punches(discarded_at);
COMMENT ON TABLE adms_discarded_punches IS 'Purged after 7 days (see backup.cron.js-style scheduled purge) — a reversibility window for data_collection_mode=stop, not permanent storage.';

-- ── Section B: new check-in-method + billing feature registry keys ─────
-- No schema change needed — these are just new keys inside plans.features
-- jsonb (already schemaless) and company_feature_overrides.feature_key
-- (already free-text). Seeded via application code, not SQL, matching how
-- every prior feature-registry key was seeded (see PlansManagement.jsx /
-- the earlier payroll-default-off session).
