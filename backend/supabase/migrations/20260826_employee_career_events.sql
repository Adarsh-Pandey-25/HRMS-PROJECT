-- Real career-history tracking. Career Timeline previously only ever
-- rendered one synthetic "Joined as {designation}" entry with nothing
-- behind it. Events are created two ways: automatically when HR edits an
-- employee's designation/department/manager/salary, and manually via an
-- "Add Career Note" action for anything that isn't a tracked field change.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS employee_career_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
    'joined', 'designation_change', 'department_change', 'manager_change',
    'salary_change', 'note'
  )),
  from_value TEXT,
  to_value TEXT,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_events_employee ON employee_career_events(employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_career_events_company ON employee_career_events(company_id);
