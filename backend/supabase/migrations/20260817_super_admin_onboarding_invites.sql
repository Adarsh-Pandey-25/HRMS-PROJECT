-- Super Admin portal + one-time company onboarding invites
-- Run in Supabase SQL Editor after previous migrations.

CREATE TABLE IF NOT EXISTS super_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name VARCHAR(200),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  email VARCHAR(255),
  company_name_hint VARCHAR(200),
  created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_invites_active
  ON onboarding_invites (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE super_admins IS 'Platform operators — not company employees';
COMMENT ON TABLE onboarding_invites IS 'One-time links required to create a new company workspace';
