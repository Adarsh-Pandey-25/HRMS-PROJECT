-- In-app notifications
-- Run this in Supabase SQL Editor (after schema.sql).

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL, -- e.g. LEAVE, REIMBURSEMENT, DOCUMENT, PAYROLL
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  link VARCHAR(300), -- frontend route like /leaves?tab=team
  meta JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

