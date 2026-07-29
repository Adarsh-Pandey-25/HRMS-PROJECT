-- =============================================================================
-- Company-scoped API keys for B2B integrations (biometric, reporting, etc.)
-- Store ONLY a hash of the key — never the plaintext secret.
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  -- Visible fragment for UI + fast lookup (e.g. hrms_live_a1b2)
  key_prefix VARCHAR(24) NOT NULL,
  -- SHA-256 hex of the full key (never store plaintext)
  key_hash VARCHAR(64) NOT NULL,
  -- live | test
  environment VARCHAR(10) NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live', 'test')),
  -- e.g. ["attendance:write", "employees:read"]
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_company_id ON api_keys (company_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_company_active
  ON api_keys (company_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE api_keys IS 'Integration API keys; only key_hash is stored, never plaintext';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hex digest of the full API key';
COMMENT ON COLUMN api_keys.key_prefix IS 'Short public prefix shown in UI and used for lookup';
