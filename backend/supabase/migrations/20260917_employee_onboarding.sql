-- Self-service onboarding: track completion state and one-time-use token.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_token_used BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.onboarding_completed IS 'True once the employee has completed the self-service onboarding flow (set password, filled profile).';
COMMENT ON COLUMN employees.onboarding_completed_at IS 'Timestamp when onboarding was completed.';
COMMENT ON COLUMN employees.onboarding_token_used IS 'Prevents replay of the onboarding JWT after successful completion.';
