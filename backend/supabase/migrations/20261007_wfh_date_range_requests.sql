-- Work-from-home requests for a date range.
--
-- Before this, WFH was one request for one day — the UI only ever offered
-- "Request WFH for today". Employees can now apply for a range the same way
-- they apply for leave, including future dates.
--
-- Shape deliberately unchanged: wfh_day_requests stays ONE ROW PER DAY, with
-- its UNIQUE (employee_id, work_date). That row-per-day is what
-- wfhRequest.service.isApprovedForDate() reads to decide whether a web
-- check-in may bypass the office-IP rule, and what the attendance calendar
-- and anomaly sweep read. Turning the table into from_date/to_date ranges
-- would have meant rewriting that check-in gate, so instead a multi-day
-- request writes one row per day and ties them together with a shared
-- batch_id.
--
-- batch_id is NULLABLE and purely a grouping key:
--   * existing rows keep batch_id NULL and behave exactly as before —
--     single-day requests, reviewed one at a time;
--   * a new request (even a one-day one) gets a batch_id, so the whole range
--     is listed as one request and approved/rejected/cancelled in one action.
--
-- Additive and idempotent — safe to re-run, and safe to deploy before the
-- application code that writes batch_id.

ALTER TABLE wfh_day_requests
  ADD COLUMN IF NOT EXISTS batch_id UUID;

COMMENT ON COLUMN wfh_day_requests.batch_id IS
  'Groups the per-day rows of one multi-day WFH request. NULL for rows created before date-range support, which are single-day requests.';

-- Reviewer and employee lists group by batch_id, and a review/cancel updates
-- every row sharing one. Partial: NULL batch_id rows are never looked up this
-- way, so they stay out of the index.
CREATE INDEX IF NOT EXISTS idx_wfh_day_requests_batch
  ON wfh_day_requests(batch_id)
  WHERE batch_id IS NOT NULL;

-- Listing pending requests for a reviewer filters by status and orders by
-- creation time; the employee list filters by employee and orders by date.
CREATE INDEX IF NOT EXISTS idx_wfh_day_requests_status_created
  ON wfh_day_requests(status, created_at);

CREATE INDEX IF NOT EXISTS idx_wfh_day_requests_employee_date
  ON wfh_day_requests(employee_id, work_date DESC);
