-- Item: bulk_import / dayone email templates promise "this temporary
-- password expires in 48 hours" — that needs to be real, not just copy.
-- must_change_password already forces a change on next login, but nothing
-- previously time-boxed how long the temp password stays valid before that
-- happens. This column + the login-time check in auth.service.js
-- (authenticateEmployee) is that enforcement.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;
