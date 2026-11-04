-- Paying salaries separately from publishing payslips (payroll defect D11).
-- After the bank pays, HR marks the payslips paid with the payment date and
-- the bank's reference (UTR). Additive and safe to run more than once.
-- Until it runs, "Mark paid" saves only the status (the date and UTR aren't kept).

ALTER TABLE payroll ADD COLUMN IF NOT EXISTS paid_on DATE;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(64);
