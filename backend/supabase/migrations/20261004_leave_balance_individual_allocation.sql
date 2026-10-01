-- 20261004_leave_balance_individual_allocation.sql
-- HR/Admin can set an individual employee's leave allocation per leave type.
--
-- allocation_override = true marks a row whose total_allocated was set for
-- that person individually. The company leave policy (on read, and "apply to
-- all employees") then leaves it alone; "Reset to policy" clears the flag.
-- Every existing row defaults to false, so nothing changes until someone
-- sets an allocation individually.
--
-- allocation_updated_at / _by record the last individual change (the full
-- history is in the audit log). Safe to run more than once.

ALTER TABLE leave_balances
  ADD COLUMN IF NOT EXISTS allocation_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocation_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS allocation_updated_by UUID REFERENCES employees(id) ON DELETE SET NULL;
