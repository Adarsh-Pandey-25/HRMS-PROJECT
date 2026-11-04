-- Employee income-tax declarations (Form 124, formerly 12BB), one per
-- employee per tax year. The employee chooses the regime and declares
-- investments, rent and any previous-employer salary; HR checks the proofs
-- and records the amounts allowed, which payroll's TDS then uses
-- (employees.salary_details.tax_profile). Additive and safe to run again.
-- Until it runs, the declaration screens say so and nothing else changes.

CREATE TABLE IF NOT EXISTS tax_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tax_year VARCHAR(7) NOT NULL,                      -- e.g. '2026-27'
  regime VARCHAR(3) NOT NULL DEFAULT 'new' CHECK (regime IN ('new', 'old')),
  declared JSONB NOT NULL DEFAULT '{}'::jsonb,       -- what the employee declared (rupees a year)
  allowed JSONB,                                      -- what HR allowed after checking
  status VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'verified', 'returned')),
  employee_note TEXT,
  hr_note TEXT,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_tax_declarations_company
  ON tax_declarations(company_id, tax_year, status);

DROP TRIGGER IF EXISTS trg_tax_declarations_updated ON tax_declarations;
CREATE TRIGGER trg_tax_declarations_updated
  BEFORE UPDATE ON tax_declarations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Only the backend (service role) reads or writes declarations; no public policies.
ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;
