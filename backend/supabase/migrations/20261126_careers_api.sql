-- Careers API (owner's request, 26 Nov 2026): a company's own website
-- (spaxads.com first) shows the jobs HR posts in SpaxSync and sends
-- applications straight back into Recruitment
-- (careers.service.js, routes/careersPublic.routes.js, CAREERS_API.md).
--
-- 1. job_openings: what the website shows. show_on_website is off for every
--    existing job, so nothing appears publicly until HR switches it on.
-- 2. candidates: what a candidate fills in on the website, the consent they
--    gave and which website they came from.
-- 3. careers_sites: one row per company: on / off, its public careers key,
--    the websites allowed to use it, the form's fields and the consent text.
--
-- Additive and safe to run more than once. Until it runs, Recruitment works
-- as before, the Careers API answers that it is not set up, and new job
-- details (work mode, salary, questions...) are not saved.

BEGIN;

-- 1. Jobs
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS summary VARCHAR(300);
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS work_mode VARCHAR(20)
  CHECK (work_mode IN ('on_site', 'remote', 'hybrid'));
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS experience_min SMALLINT
  CHECK (experience_min BETWEEN 0 AND 60);
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS experience_max SMALLINT
  CHECK (experience_max BETWEEN 0 AND 60);
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS salary_min NUMERIC(14, 2) CHECK (salary_min >= 0);
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS salary_max NUMERIC(14, 2) CHECK (salary_max >= 0);
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS salary_currency VARCHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS salary_period VARCHAR(10) NOT NULL DEFAULT 'year'
  CHECK (salary_period IN ('year', 'month'));
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS show_salary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS skills JSONB NOT NULL DEFAULT '[]'::jsonb;
-- After this date the job is no longer shown on the website.
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS closes_on DATE;
-- Extra questions for this job: [{"id","label","type","required","options"}].
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS questions JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_job_openings_company_website
  ON job_openings(company_id, status, show_on_website);

-- 2. Candidates
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- The website an application came from, e.g. "spaxads.com".
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source_detail VARCHAR(200);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_location VARCHAR(200);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS experience_years NUMERIC(4, 1)
  CHECK (experience_years >= 0 AND experience_years <= 60);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_company VARCHAR(200);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_ctc NUMERIC(14, 2) CHECK (current_ctc >= 0);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_ctc NUMERIC(14, 2) CHECK (expected_ctc >= 0);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ctc_currency VARCHAR(3);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS notice_period_days SMALLINT
  CHECK (notice_period_days BETWEEN 0 AND 365);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(300);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(300);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS cover_note TEXT;
-- Answers to the job's extra questions: [{"questionId","question","answer"}].
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb;
-- When the candidate ticked the consent box, and the words they agreed to.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_text TEXT;

-- A second application for the same job, and the day's count, are looked up by these.
CREATE INDEX IF NOT EXISTS idx_candidates_company_job_email ON candidates(company_id, job_id, email);
CREATE INDEX IF NOT EXISTS idx_candidates_company_source_created ON candidates(company_id, source, created_at);

-- 3. One careers website setup per company
CREATE TABLE IF NOT EXISTS careers_sites (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Public by design (it sits in the website's page, like a maps key): it
  -- only says which company's jobs to show. The allowed websites, the
  -- limits and the robot check are what protect it.
  site_key VARCHAR(64) NOT NULL UNIQUE,
  -- ["https://spaxads.com", "https://www.spaxads.com"]
  allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- {"phone": "required", "coverNote": "optional", "portfolioUrl": "hidden", ...}
  form_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_text TEXT,
  -- At most this many website applications a day for the company.
  daily_limit INTEGER NOT NULL DEFAULT 200 CHECK (daily_limit BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- Only the backend (service role) reads or writes it; no public policies.
ALTER TABLE careers_sites ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE careers_sites IS 'Careers API set-up per company: on/off, public site key, allowed websites, form fields, consent text, daily limit. See careers.service.js.';
COMMENT ON COLUMN job_openings.show_on_website IS 'Shown by the Careers API on the company''s own website (only while open and before closes_on).';

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20261126_careers_api.sql', true)
  ON CONFLICT (filename) DO NOTHING;

COMMIT;
