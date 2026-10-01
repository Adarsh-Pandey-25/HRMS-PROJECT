-- 20261003_employee_profile_completion.sql
-- HR/Admin can add an employee without their personal details (date of
-- birth, contact, address, emergency contact, bank details). The employee
-- is asked for whatever is missing the first time they sign in, and cannot
-- reach the rest of the app until it is filled in.
--
-- profile_completed = false marks "still to fill in". The default is TRUE,
-- so every employee who already exists is treated as complete and is never
-- asked; only people added after this lands, without full details, are.
-- Adding a column with a constant default does not rewrite the table.
-- Safe to run more than once.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;
