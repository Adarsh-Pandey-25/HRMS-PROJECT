-- Onboarding Checklist was five hardcoded checkboxes with no state handler,
-- API, or backing table — checking them was inert and reset on reload. This
-- makes it real and admin-configurable, the same shape as Document Types:
-- a per-company template list HR can add/remove/reorder, and a per-candidate
-- checked-state table. Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS onboarding_checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  label VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, label)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_templates_company ON onboarding_checklist_templates(company_id, sort_order);

-- Seed every existing company with the same 5 items the old hardcoded UI had,
-- so behavior looks identical on day one before any admin customizes it.
INSERT INTO onboarding_checklist_templates (company_id, label, sort_order)
SELECT c.id, item.label, item.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('Create employee record', 0),
  ('Assign work email & laptop', 1),
  ('Send welcome kit', 2),
  ('Schedule orientation', 3),
  ('Add to payroll', 4)
) AS item(label, sort_order)
ON CONFLICT (company_id, label) DO NOTHING;

CREATE TABLE IF NOT EXISTS onboarding_checklist_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES onboarding_checklist_templates(id) ON DELETE CASCADE,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  checked_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ,
  UNIQUE (candidate_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_status_candidate ON onboarding_checklist_status(candidate_id);
