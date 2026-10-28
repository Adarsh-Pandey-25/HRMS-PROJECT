-- 20261028_whatsapp_channel.sql
-- WhatsApp notifications through the WhatsApp Cloud API.
--
-- Adds new tables and one function only. No existing table, column or row is
-- touched, so running this changes nothing for anyone until WhatsApp is
-- switched on (WHATSAPP_ENABLED) and enabled for a company.
--
-- 1. whatsapp_links            — who connected their WhatsApp, and when they agreed
-- 2. whatsapp_link_codes       — one-time JOIN codes used to connect
-- 3. whatsapp_messages         — outbox and log: one row per WhatsApp message
-- 4. whatsapp_inbound          — inbound messages already handled (Meta retries)
-- 5. company_whatsapp_settings — a company's on/off switch and message groups
-- 6. platform_whatsapp_state   — the super-admin pause switch, per environment
-- 7. whatsapp_claim_outbox()   — hands each queued message to exactly one sender

CREATE TABLE IF NOT EXISTS whatsapp_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('employee', 'super_admin')),
  -- employees.id or super_admins.id, depending on subject_type.
  subject_id UUID NOT NULL,
  -- Null for a super admin.
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  -- Digits with country code, as Meta sends it (e.g. 919876543210). Null
  -- when the person uses a WhatsApp username and Meta hides the number.
  phone VARCHAR(20),
  -- Meta's business-scoped user id (e.g. IN.1234...), on every inbound
  -- message since April 2026.
  bsuid VARCHAR(160),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'opted_out', 'closed')),
  -- The person's own switches, e.g. {"attendance": false}. Missing means on.
  groups JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_version VARCHAR(20) NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  consent_source VARCHAR(30) NOT NULL DEFAULT 'whatsapp_join',
  opted_out_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_links_phone ON whatsapp_links(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_bsuid ON whatsapp_links(bsuid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_company ON whatsapp_links(company_id);

CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the code; the code itself is never stored.
  code_hash CHAR(64) NOT NULL UNIQUE,
  subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('employee', 'super_admin')),
  subject_id UUID NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_link_codes_subject
  ON whatsapp_link_codes(subject_type, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'production', or 'dev:<computer name>' for a developer's machine. Both
  -- can share this table; each sender only ever claims its own rows.
  environment VARCHAR(80) NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  subject_type VARCHAR(20) NOT NULL,
  subject_id UUID NOT NULL,
  -- Phone digits, or the BSUID when the number is hidden.
  recipient VARCHAR(160) NOT NULL,
  recipient_kind VARCHAR(10) NOT NULL DEFAULT 'phone' CHECK (recipient_kind IN ('phone', 'bsuid')),
  -- What happened (e.g. leave_approved) and what triggered it (email type
  -- or in-app notification type).
  event_key VARCHAR(80) NOT NULL,
  source VARCHAR(80),
  -- One message per event per person: event + record + recipient.
  dedupe_key VARCHAR(300) NOT NULL UNIQUE,
  template VARCHAR(80) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('utility', 'marketing')),
  message_group VARCHAR(40) NOT NULL,
  -- The template's blanks. Never salaries, reasons, passwords or codes:
  -- whatsappCatalog.js only builds non-sensitive values.
  params JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  skip_reason VARCHAR(60),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  wa_message_id VARCHAR(200) UNIQUE,
  error_code VARCHAR(20),
  error_title VARCHAR(300),
  -- From Meta's status webhook: what Meta charged for, if anything.
  pricing_category VARCHAR(30),
  billable BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_claim
  ON whatsapp_messages(environment, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created ON whatsapp_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_company_created
  ON whatsapp_messages(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_inbound (
  wa_message_id VARCHAR(200) PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_type VARCHAR(30),
  -- What we did with it: join, stop, start, help, stop_marketing, other.
  -- The message text itself is never stored.
  action VARCHAR(30),
  -- SHA-256 of the sender's number or BSUID, to answer "other" messages
  -- at most once a day without storing who sent them.
  sender_hash CHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_sender
  ON whatsapp_inbound(sender_hash, received_at DESC);

CREATE TABLE IF NOT EXISTS company_whatsapp_settings (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Groups the company has switched off for everyone, e.g. {"team_celebrations": false}.
  groups JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_whatsapp_state (
  -- 'production' or 'dev:<computer name>', like whatsapp_messages.environment.
  environment VARCHAR(80) PRIMARY KEY,
  paused BOOLEAN NOT NULL DEFAULT false,
  paused_reason VARCHAR(300),
  paused_by VARCHAR(320),
  paused_at TIMESTAMPTZ,
  last_webhook_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backend-only (service role); no public policies.
ALTER TABLE whatsapp_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_whatsapp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_whatsapp_state ENABLE ROW LEVEL SECURITY;

-- Claims due messages for one environment, so production and a developer's
-- machine never send each other's rows, and two workers never send one row
-- twice (SKIP LOCKED). A row left in 'sending' is never re-claimed: a crash
-- mid-send must not message the person twice (whatsappWorker.js marks it
-- failed instead).
CREATE OR REPLACE FUNCTION whatsapp_claim_outbox(p_environment TEXT, p_limit INTEGER)
RETURNS SETOF whatsapp_messages
LANGUAGE sql
AS $$
  UPDATE whatsapp_messages m
     SET status = 'sending', claimed_at = NOW(), attempts = m.attempts + 1, updated_at = NOW()
   WHERE m.id IN (
     SELECT id FROM whatsapp_messages
      WHERE environment = p_environment
        AND status = 'queued'
        AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at
      LIMIT LEAST(GREATEST(p_limit, 1), 50)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING m.*;
$$;

REVOKE ALL ON FUNCTION whatsapp_claim_outbox(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp_claim_outbox(TEXT, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp_claim_outbox(TEXT, INTEGER) TO service_role;

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20261028_whatsapp_channel.sql', true)
  ON CONFLICT (filename) DO NOTHING;
