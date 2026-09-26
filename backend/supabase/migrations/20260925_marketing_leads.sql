-- Leads from the public marketing site: /start-trial (free-trial requests)
-- and /contact. A super-admin reviews each lead and can turn a trial
-- request into an onboarding invite, which is linked back via invite_id.

CREATE TABLE IF NOT EXISTS marketing_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('trial', 'contact')),
  full_name VARCHAR(200) NOT NULL,
  work_email VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  company_name VARCHAR(200),
  company_size VARCHAR(30),
  message TEXT,
  desired_slug VARCHAR(63),
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'invited', 'rejected')),
  invite_id UUID REFERENCES onboarding_invites(id) ON DELETE SET NULL,
  source_path VARCHAR(200),
  ip_address VARCHAR(64),
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_status ON marketing_leads(status);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_created_at ON marketing_leads(created_at DESC);

DROP TRIGGER IF EXISTS trg_marketing_leads_updated ON marketing_leads;
CREATE TRIGGER trg_marketing_leads_updated
  BEFORE UPDATE ON marketing_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Only the backend (service role) reads or writes leads; no public policies.
ALTER TABLE marketing_leads ENABLE ROW LEVEL SECURITY;
