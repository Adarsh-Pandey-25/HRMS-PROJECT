-- Redesign of biometric check-in/check-out: grace-period-gated, continuously
-- re-evaluated checkout + status until the shift window closes, then locked.
-- device_punches already serves as the raw punch log (employee_id,
-- company_id, punch_time, device_serial, punch_type as the device's own
-- IN/OUT label) — nothing new needed there.

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS checkout_status TEXT NOT NULL DEFAULT 'finalized'
    CHECK (checkout_status IN ('pending', 'provisional', 'finalized')),
  ADD COLUMN IF NOT EXISTS last_punch_at TIMESTAMPTZ;

-- Default 'finalized' so every existing row (and every row written by the
-- untouched web/manual/office_ip paths) is immediately treated as
-- authoritative by the new finalized-only gates in getMonthlySummary,
-- getRangeSummary, and the anomaly cron — only rows this rework's own
-- biometric recompute function creates ever start at 'pending'.

CREATE INDEX IF NOT EXISTS idx_attendance_checkout_status
  ON attendance(checkout_status)
  WHERE checkout_status != 'finalized';
-- Used by the new periodic transition job to find pending/provisional
-- biometric rows without scanning the whole table.
