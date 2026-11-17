-- Two-step login (employee TOTP) — audit finding #28.
--
-- 1) two_fa_login_challenges: one row per sign-in that has passed the
--    password and still needs the authenticator code. The pending token the
--    browser holds carries the row's id (jti). The row makes that token
--    single-use and caps it at 5 tries, in the database, so the limits hold
--    across every backend process. Rows are only needed for 5 minutes; the
--    backend deletes an employee's expired rows each time they sign in.
-- 2) employees.totp_last_used_step: the last 30-second code step accepted at
--    sign-in, so the same code can't be used twice (replay).
--
-- Additive and safe to run more than once. Until it runs, employees with
-- two-step login on can't finish signing in (they couldn't before this fix
-- either); everyone else is unaffected.

CREATE TABLE IF NOT EXISTS two_fa_login_challenges (
  jti UUID PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_two_fa_login_challenges_employee
  ON two_fa_login_challenges(employee_id, expires_at);

-- Only the backend (service role) reads or writes it; no public policies.
ALTER TABLE two_fa_login_challenges ENABLE ROW LEVEL SECURITY;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;

COMMENT ON TABLE two_fa_login_challenges IS 'Pending two-step sign-ins (password OK, code still needed). 5-minute life, single use, at most 5 code tries. See auth.service.js.';
COMMENT ON COLUMN employees.totp_last_used_step IS 'Last TOTP time step (unix seconds / 30) accepted at sign-in. A code is accepted only for a later step (replay protection).';

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20261117_two_step_login.sql', true)
  ON CONFLICT (filename) DO NOTHING;
