-- =============================================================================
-- ADMS biometric integration (eSSL X2008 push protocol)
-- Raw punch log from the device. Intentionally separate from the existing
-- `attendance` table (daily check-in/check-out records computed elsewhere) —
-- this is a per-scan log, not a daily summary.
-- =============================================================================

CREATE TABLE IF NOT EXISTS device_punches (
  id BIGSERIAL PRIMARY KEY,
  device_user_id TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  punch_type TEXT NOT NULL CHECK (punch_type IN ('checkin', 'checkout', 'overtime_in', 'overtime_out', 'unknown')),
  verify_mode TEXT,
  device_serial TEXT,
  raw_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_user_id, punch_time)
);

CREATE INDEX IF NOT EXISTS idx_device_punches_employee ON device_punches(employee_id);
CREATE INDEX IF NOT EXISTS idx_device_punches_company_time ON device_punches(company_id, punch_time DESC);
CREATE INDEX IF NOT EXISTS idx_device_punches_punch_time ON device_punches(punch_time DESC);

-- Tracks the last time each physical device was heard from (heartbeat or punch),
-- so /adms/test can report connection status without holding in-memory state
-- (the API can run as more than one instance).
CREATE TABLE IF NOT EXISTS device_heartbeats (
  device_serial TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps a device's local user id (e.g. fingerprint enrollment id) to an employee.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS device_user_id TEXT UNIQUE;
