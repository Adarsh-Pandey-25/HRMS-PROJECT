-- Payroll v2: month workflow + draft/publish payslips
-- Run this in Supabase SQL editor if payroll_months does not exist yet.

CREATE TABLE IF NOT EXISTS payroll_months (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month, year)
);

ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS payroll_month_id UUID REFERENCES payroll_months(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payslip_status VARCHAR(20) DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS lop_deduction DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_days DECIMAL(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breakdown_json JSONB;

CREATE INDEX IF NOT EXISTS idx_payroll_month_id ON payroll(payroll_month_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payslip_status ON payroll(payslip_status);

-- Dynamic Payroll Components (Settings-managed salary structure)
CREATE TABLE IF NOT EXISTS payroll_components (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('EARNING', 'DEDUCTION')),
  name VARCHAR(120) NOT NULL,
  is_fixed BOOLEAN NOT NULL DEFAULT false,
  fixed_amount DECIMAL(12,2),
  target_field VARCHAR(80),
  operator VARCHAR(10),
  operand_field VARCHAR(80),
  operand_value DECIMAL(12,4),
  output_field VARCHAR(80),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_components_active ON payroll_components(is_active);
CREATE INDEX IF NOT EXISTS idx_payroll_components_order ON payroll_components(display_order);
