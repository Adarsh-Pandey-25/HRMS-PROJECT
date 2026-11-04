-- Payroll pays someone who leaves mid-month up to their last working day
-- (defect D7 in docs/Payroll-Industry-Standard-Comparison.txt — leavers used
-- to be skipped and got no payslip for their last month).
--
-- Offboarding records the date here. Until this runs, offboarding still
-- works and payroll uses the offboarding date instead. Safe to run more
-- than once.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_working_day DATE;
