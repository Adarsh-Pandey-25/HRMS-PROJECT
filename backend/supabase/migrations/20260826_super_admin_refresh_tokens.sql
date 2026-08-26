-- Refresh-token storage for platform Super Admin sessions.
-- Mirrors `refresh_tokens` (employee sessions): only a hash is stored, and the
-- refresh endpoint rotates it (old row deleted the instant a new token is issued).
-- Run in Supabase SQL Editor after previous migrations.

CREATE TABLE IF NOT EXISTS super_admin_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_refresh_tokens_admin
  ON super_admin_refresh_tokens(super_admin_id);

COMMENT ON TABLE super_admin_refresh_tokens IS 'Hashed refresh tokens for super admin sessions — the 24h access token can be renewed without a full re-login';
