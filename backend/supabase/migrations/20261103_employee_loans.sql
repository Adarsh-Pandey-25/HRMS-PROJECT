-- Loans and salary advances recovered through payroll (payroll Phase 4).
-- HR records the amount and the monthly instalment; each published payslip
-- recovers min(instalment, what is left) and is recorded once in
-- employee_loan_recoveries. Additive and safe to run more than once.
-- Until it runs, payroll deducts no loans and the Loans screen says so.

CREATE TABLE IF NOT EXISTS employee_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL DEFAULT 'loan' CHECK (kind IN ('loan', 'advance')),
  principal NUMERIC(12, 2) NOT NULL CHECK (principal > 0),
  instalment NUMERIC(12, 2) NOT NULL CHECK (instalment > 0),
  start_month SMALLINT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_year SMALLINT NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  recovered NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (recovered >= 0),
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'cancelled')),
  note TEXT,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_loans_employee
  ON employee_loans(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_loans_company
  ON employee_loans(company_id, status);

-- One recovery per loan per payslip, so a payslip can never recover twice.
CREATE TABLE IF NOT EXISTS employee_loan_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
  payroll_id UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
  month SMALLINT NOT NULL,
  year SMALLINT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, payroll_id)
);

DROP TRIGGER IF EXISTS trg_employee_loans_updated ON employee_loans;
CREATE TRIGGER trg_employee_loans_updated
  BEFORE UPDATE ON employee_loans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Only the backend (service role) reads or writes these; no public policies.
ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loan_recoveries ENABLE ROW LEVEL SECURITY;
