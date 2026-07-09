-- Leave Types v2 (Custom leave types)
-- Run this in Supabase SQL editor.
-- Goal: Remove hard enum dependency so Admin can create custom leave types.

-- 1) Create leave_types master table
CREATE TABLE IF NOT EXISTS leave_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_types_active ON leave_types(is_active);

-- 2) Convert enum columns to text (keeps existing values)
-- leave_balances.leave_type
ALTER TABLE leave_balances
  ALTER COLUMN leave_type TYPE VARCHAR(40) USING leave_type::text;

-- leaves.leave_type
ALTER TABLE leaves
  ALTER COLUMN leave_type TYPE VARCHAR(40) USING leave_type::text;

-- 3) Seed existing enum values into leave_types (if not already)
INSERT INTO leave_types (code, name, is_active)
VALUES
  ('CL', 'Casual Leave', true),
  ('SL', 'Sick Leave', true),
  ('EL', 'Earned Leave', true),
  ('WFH', 'Work From Home', true),
  ('COMP_OFF', 'Comp Off', true),
  ('MATERNITY', 'Maternity Leave', true),
  ('PATERNITY', 'Paternity Leave', true),
  ('UNPAID', 'Unpaid Leave', true)
ON CONFLICT (code) DO NOTHING;

-- 4) (Optional) Drop the old enum type if nothing else uses it
-- WARNING: Only run if you're sure no column still uses leave_type enum.
-- DROP TYPE IF EXISTS leave_type;

