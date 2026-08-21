-- Mapping table between eSSL device local user IDs (simple numbers) and
-- HRMS employee UUIDs. Scoped by device_serial so the same numeric ID can
-- be reused across different physical devices without colliding.
CREATE TABLE IF NOT EXISTS device_employee_mapping (
  id BIGSERIAL PRIMARY KEY,
  device_user_id TEXT NOT NULL,
  device_serial TEXT NOT NULL DEFAULT 'NFZ8244800715',
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_user_id, device_serial)
);

-- Index for fast lookup on every punch
CREATE INDEX IF NOT EXISTS idx_mapping_lookup
  ON device_employee_mapping(device_user_id, device_serial);
