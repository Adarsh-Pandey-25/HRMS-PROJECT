-- Employee self-service 2FA (TOTP) — mirrors the super-admin 2FA pattern.
-- Storage is AES-256-GCM encrypted (see utils/totp.js), never plaintext.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_secret TEXT;

COMMENT ON COLUMN employees.two_fa_enabled IS 'Employee opted into 2FA. Login (password step) returns requires2FA=true when true.';
COMMENT ON COLUMN employees.totp_secret IS 'AES-256-GCM encrypted TOTP seed (see utils/totp.js). Null when 2FA is disabled. Present = enrollment has started. two_fa_enabled = true means enrollment confirmed and active.';
