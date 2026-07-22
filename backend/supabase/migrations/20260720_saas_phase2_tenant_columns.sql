-- =============================================================================
-- MULTI-TENANT SaaS — Phase 2 (run AFTER Phase 1)
-- Adds company_id to shared tables + backfills to default company.
-- Fixes payroll_months unique so each company can run the same month.
-- =============================================================================

-- Helper: default company
-- '00000000-0000-0000-0000-000000000001'

-- ---------- payroll_months (CRITICAL) ----------
ALTER TABLE payroll_months
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE payroll_months
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE payroll_months
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE payroll_months
  ALTER COLUMN company_id SET NOT NULL;

-- Drop old global unique (month, year) if it exists, replace with per-company
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_months_month_year_key'
  ) THEN
    ALTER TABLE payroll_months DROP CONSTRAINT payroll_months_month_year_key;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- Also try common auto names
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'payroll_months'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%month%'
      AND pg_get_constraintdef(c.oid) ILIKE '%year%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%company_id%'
  LOOP
    EXECUTE format('ALTER TABLE payroll_months DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_months_company_month_year
  ON payroll_months (company_id, month, year);

CREATE INDEX IF NOT EXISTS idx_payroll_months_company ON payroll_months(company_id);

-- ---------- payroll_components ----------
ALTER TABLE payroll_components
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE payroll_components
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE payroll_components
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_payroll_components_company ON payroll_components(company_id);

-- ---------- announcements ----------
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE announcements a
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = a.published_by),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

ALTER TABLE announcements
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_announcements_company ON announcements(company_id);

-- ---------- holidays ----------
ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE holidays h
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = h.created_by),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

ALTER TABLE holidays
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_holidays_company ON holidays(company_id);

-- ---------- assets ----------
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE assets a
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = a.assigned_to),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

ALTER TABLE assets
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_assets_company ON assets(company_id);

-- ---------- asset_categories ----------
ALTER TABLE asset_categories
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE asset_categories
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE asset_categories
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_asset_categories_company ON asset_categories(company_id);

-- ---------- asset_requests (optional; already scoped via employee) ----------
ALTER TABLE asset_requests
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE asset_requests r
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = r.employee_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_asset_requests_company ON asset_requests(company_id);

-- ---------- recruitment ----------
ALTER TABLE job_openings
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE job_openings
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE job_openings
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_job_openings_company ON job_openings(company_id);

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE candidates c
SET company_id = COALESCE(
  (SELECT j.company_id FROM job_openings j WHERE j.id = c.job_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_company ON candidates(company_id);

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE interviews i
SET company_id = COALESCE(
  (SELECT c.company_id FROM candidates c WHERE c.id = i.candidate_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_interviews_company ON interviews(company_id);

ALTER TABLE job_offers
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE job_offers o
SET company_id = COALESCE(
  (SELECT c.company_id FROM candidates c WHERE c.id = o.candidate_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_offers_company ON job_offers(company_id);

-- ---------- performance ----------
ALTER TABLE review_cycles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE review_cycles
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE review_cycles
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_review_cycles_company ON review_cycles(company_id);

-- ---------- LMS courses (if table exists) ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'courses') THEN
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
    UPDATE courses SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
    ALTER TABLE courses ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
    CREATE INDEX IF NOT EXISTS idx_courses_company ON courses(company_id);
  END IF;
END $$;

-- ---------- helpdesk / KB ----------
ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE helpdesk_tickets t
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = t.raised_by),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_company ON helpdesk_tickets(company_id);

-- KB categories use string id — keep shared seed for default; new companies get their own later via code
ALTER TABLE kb_articles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE kb_articles
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE kb_articles
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_kb_articles_company ON kb_articles(company_id);

-- Verify samples
-- SELECT 'payroll_months' AS t, company_id, COUNT(*) FROM payroll_months GROUP BY 1,2
-- UNION ALL SELECT 'job_openings', company_id, COUNT(*) FROM job_openings GROUP BY 1,2
-- UNION ALL SELECT 'assets', company_id, COUNT(*) FROM assets GROUP BY 1,2;
