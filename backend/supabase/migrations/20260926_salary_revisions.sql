-- Salary revisions: HR/Admin change an employee's monthly salary components
-- with an effective date and a reason. A revision dated today or earlier is
-- applied straight away; a future-dated one stays 'scheduled' until the daily
-- salary-revision cron applies it on its effective date. Applying copies
-- new_salary into employees.salary_details and logs a salary_change career
-- event, so payroll and the employee timeline pick it up.

CREATE TABLE IF NOT EXISTS salary_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Monthly earning components (basic, hra, da, special, transport, medical).
  -- previous_* is re-captured at apply time for scheduled revisions.
  previous_salary JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_salary JSONB NOT NULL,
  previous_monthly_gross NUMERIC(12, 2) NOT NULL DEFAULT 0,
  new_monthly_gross NUMERIC(12, 2) NOT NULL CHECK (new_monthly_gross > 0),
  effective_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'applied', 'cancelled')),
  applied_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_revisions_company
  ON salary_revisions(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_salary_revisions_employee
  ON salary_revisions(employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_salary_revisions_due
  ON salary_revisions(effective_date) WHERE status = 'scheduled';

-- At most one pending revision per employee, so two future changes can
-- never race each other. Cancel the pending one to schedule another.
CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_revisions_one_scheduled
  ON salary_revisions(employee_id) WHERE status = 'scheduled';

DROP TRIGGER IF EXISTS trg_salary_revisions_updated ON salary_revisions;
CREATE TRIGGER trg_salary_revisions_updated
  BEFORE UPDATE ON salary_revisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Only the backend (service role) reads or writes revisions; no public policies.
ALTER TABLE salary_revisions ENABLE ROW LEVEL SECURITY;
