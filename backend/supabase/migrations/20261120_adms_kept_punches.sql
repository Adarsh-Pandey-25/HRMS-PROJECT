-- 20261120_adms_kept_punches.sql
-- A biometric machine whose office internet address (IP) changed: its
-- punches are now kept, not refused, until someone approves the new IP
-- (owner's request, 20 Nov 2026).
--
-- Until now a push from an IP the machine isn't pinned to was refused, on
-- the understanding that the machine keeps the punches and sends them again.
-- On 20 Nov 2026 the Spaxads machine did not: the morning's punches never
-- came back after the new IP was allowed. Now SpaxSync keeps them itself.
--
-- 1. adms_ip_requests — one per machine and new IP: pending, approved or
--    rejected. The WhatsApp Approve / Reject buttons point at its id.
-- 2. adms_kept_punches — the punches a machine sent from a new IP. They
--    count only once that IP is allowed (they are then saved into
--    device_punches like any punch); until then nothing reads them.
-- 3. whatsapp_actions.kind may now also be 'device_ip'.
--
-- Additive only; no existing row changes. Until this runs, the server keeps
-- refusing punches from a new IP exactly as before.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS adms_ip_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_serial TEXT NOT NULL,
  -- The new IP, and the IP the machine was allowed from when it appeared.
  ip TEXT NOT NULL,
  previous_ip TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at TIMESTAMPTZ,
  -- employees.id of whoever decided; empty when the machine was re-learned.
  decided_by UUID,
  decided_via VARCHAR(10) CHECK (decided_via IN ('website', 'whatsapp', 'relearn'))
);
-- At most one pending request per machine and IP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adms_ip_requests_pending
  ON adms_ip_requests(device_serial, ip) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_adms_ip_requests_device ON adms_ip_requests(device_serial, created_at DESC);

CREATE TABLE IF NOT EXISTS adms_kept_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_serial TEXT NOT NULL,
  source_ip TEXT NOT NULL,
  -- The punch, as device_punches gets it once the IP is allowed.
  device_user_id TEXT NOT NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  punch_type TEXT NOT NULL,
  verify_mode TEXT,
  raw_data TEXT,
  -- Set once saved into device_punches. Saved rows are removed after 7 days;
  -- rows whose IP is never allowed, after 60.
  released_at TIMESTAMPTZ,
  UNIQUE (device_serial, source_ip, device_user_id, punch_time)
);
CREATE INDEX IF NOT EXISTS idx_adms_kept_punches_waiting
  ON adms_kept_punches(device_serial, source_ip, punch_time) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_adms_kept_punches_purge ON adms_kept_punches(received_at);

-- Backend-only (service role); no public policies.
ALTER TABLE adms_ip_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE adms_kept_punches ENABLE ROW LEVEL SECURITY;

-- Approve / Reject on WhatsApp for a new IP: whatsapp_actions.kind gets
-- 'device_ip' (its record_id is adms_ip_requests.id).
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'whatsapp_actions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE whatsapp_actions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE whatsapp_actions ADD CONSTRAINT whatsapp_actions_kind_check
  CHECK (kind IN ('leave', 'wfh', 'expense', 'regularization', 'device_ip'));
