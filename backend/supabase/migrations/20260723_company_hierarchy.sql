-- =============================================================================
-- Parent / child company hierarchy
-- Admin of a parent (or standalone that becomes parent) can create child companies.
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS parent_company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS company_type VARCHAR(20) NOT NULL DEFAULT 'standalone';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_company_type_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_company_type_check
      CHECK (company_type IN ('standalone', 'parent', 'child'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_parent_company_id
  ON companies (parent_company_id)
  WHERE parent_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_company_type
  ON companies (company_type);

-- Children must have a parent; parents/standalones must not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_parent_child_consistency'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_parent_child_consistency
      CHECK (
        (company_type = 'child' AND parent_company_id IS NOT NULL)
        OR (company_type IN ('standalone', 'parent') AND parent_company_id IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN companies.parent_company_id IS 'Set only for child companies; points to parent tenant';
COMMENT ON COLUMN companies.company_type IS 'standalone | parent | child';
