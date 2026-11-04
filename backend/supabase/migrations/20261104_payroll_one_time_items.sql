-- One-time pay and recoveries on a month's payslip (payroll Phase 4): arrears,
-- bonus, incentives, leave encashment, gratuity, pay in lieu of notice, and
-- recoveries such as notice not served. HR adds them on the employee's
-- Payroll tab, or the full and final settlement adds them. The month's draft
-- payslip includes them; income tax on them is worked out by the difference
-- method. Once the payslip is published its items can't change.
-- Additive and safe to run more than once. Until it runs, payroll adds no
-- one-time pay and the screen says so.

CREATE TABLE IF NOT EXISTS payroll_one_time_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year SMALLINT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  kind VARCHAR(20) NOT NULL CHECK (kind IN (
    'arrears', 'bonus', 'incentive', 'leave_encashment', 'gratuity', 'notice_pay', 'other_earning',
    'notice_recovery', 'other_deduction'
  )),
  name VARCHAR(80) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  pf_wage BOOLEAN NOT NULL DEFAULT FALSE,
  esi_wage BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'fnf')),
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  note TEXT,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_one_time_items_employee
  ON payroll_one_time_items(employee_id, year, month, status);
CREATE INDEX IF NOT EXISTS idx_one_time_items_company
  ON payroll_one_time_items(company_id, year, month);

-- The same item can be on a payslip once (a double click can't add it twice).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_time_items_active
  ON payroll_one_time_items(employee_id, year, month, kind, name, amount)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_one_time_items_updated ON payroll_one_time_items;
CREATE TRIGGER trg_one_time_items_updated
  BEFORE UPDATE ON payroll_one_time_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Only the backend (service role) reads or writes it; no public policies.
ALTER TABLE payroll_one_time_items ENABLE ROW LEVEL SECURITY;
