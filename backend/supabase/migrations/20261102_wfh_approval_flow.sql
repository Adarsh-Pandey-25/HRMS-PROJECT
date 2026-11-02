-- 20261102_wfh_approval_flow.sql
-- Two additions to wfh_day_requests (owner's decisions, 2 Nov 2026). No
-- existing row changes, and every request already in the table keeps
-- working as before. Safe to run more than once.
--
-- 1. Work-from-home requests follow Settings → Approval Flows, like leave and
--    expense claims. Under "Manager → HR" the manager approves first and HR
--    gives the final approval; manager_approved_by / _at record the manager's
--    step (leaves and reimbursements already have the same pair).
--
-- 2. An office employee may check in while their WFH request for the day is
--    still waiting. Approval makes that check-in count from its own time;
--    rejection (or cancelling the request) takes it out of attendance, and
--    voided_check_in_at / _out_at keep its times on the request, so the
--    employee's profile can show it as not counted.

ALTER TABLE wfh_day_requests
  ADD COLUMN IF NOT EXISTS manager_approved_by UUID REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE wfh_day_requests
  ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ;

ALTER TABLE wfh_day_requests
  ADD COLUMN IF NOT EXISTS voided_check_in_at TIMESTAMPTZ;

ALTER TABLE wfh_day_requests
  ADD COLUMN IF NOT EXISTS voided_check_out_at TIMESTAMPTZ;
