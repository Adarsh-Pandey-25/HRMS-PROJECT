-- =============================================================================
-- Item 5: real outbound webhook system — replaces the frontend-only stub
-- that just stored URLs in integrations_config with no delivery mechanism.
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL, -- apiKey.service.js's hashKey() convention — raw secret shown once at creation, never stored/returned again
  subscribed_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_company ON webhooks(company_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT, -- truncated to a few KB at write time — never store an unbounded response
  attempt_number INTEGER NOT NULL DEFAULT 1,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
