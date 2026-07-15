-- Per-employee attendance / check-in mode
-- office = must check in from office IP whitelist
-- wfh    = allowed from any network

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) NOT NULL DEFAULT 'office';

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_attendance_mode_check;

ALTER TABLE employees
  ADD CONSTRAINT employees_attendance_mode_check
  CHECK (attendance_mode IN ('office', 'wfh'));

COMMENT ON COLUMN employees.attendance_mode IS 'office = require office IP for check-in; wfh = any network allowed';
