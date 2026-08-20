-- Require password change after first login with a temporary password.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.must_change_password IS
  'When true, user must set a new password before using the app (temp password from welcome email).';
