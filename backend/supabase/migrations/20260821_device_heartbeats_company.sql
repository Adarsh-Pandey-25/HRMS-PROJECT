-- Multi-tenant device ownership: a device is "claimed" by whichever company
-- first registers its serial from the frontend. Unclaimed heartbeats
-- (company_id IS NULL) are visible to nobody until claimed.
ALTER TABLE device_heartbeats
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS idx_device_heartbeats_company ON device_heartbeats(company_id);
