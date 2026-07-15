-- Daily WFH requests — employee requests; manager or HR/Admin approves.
CREATE TABLE IF NOT EXISTS wfh_day_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason TEXT,
  reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_wfh_day_requests_status ON wfh_day_requests(status);
CREATE INDEX IF NOT EXISTS idx_wfh_day_requests_work_date ON wfh_day_requests(work_date);
CREATE INDEX IF NOT EXISTS idx_wfh_day_requests_employee ON wfh_day_requests(employee_id);

COMMENT ON TABLE wfh_day_requests IS 'Occasional WFH for a calendar day — requires manager/HR approval before check-in bypasses office IP';
