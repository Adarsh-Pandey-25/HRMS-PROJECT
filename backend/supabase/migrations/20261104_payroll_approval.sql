-- Approval before publishing (maker-checker), a company choice in Settings →
-- Payroll → Calculation. When it is on, a second person approves each draft
-- payslip before it can be published. The approval is of the exact figures
-- (approved_figures): if the draft changes after approval, it must be
-- approved again. Whoever approved a payslip can't also publish it.
-- Additive and safe to run more than once. Until it runs, turning the choice
-- on stops publishing with a message to run this file.

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS approved_figures TEXT;
