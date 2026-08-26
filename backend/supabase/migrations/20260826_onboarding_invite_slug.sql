-- Subdomain-per-tenant: the company's subdomain is now locked in at invite
-- creation time (super admin picks/edits an auto-suggested slug), so it's
-- ready the moment the invited admin finishes onboarding instead of getting
-- a meaningless co-{uuid} slug. Run in Supabase SQL Editor.
ALTER TABLE onboarding_invites ADD COLUMN IF NOT EXISTS company_slug VARCHAR(63);
