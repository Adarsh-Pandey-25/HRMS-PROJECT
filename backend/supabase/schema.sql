-- HRMS Database Schema for Supabase (PostgreSQL)
-- Run this in Supabase SQL Editor

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE user_role AS ENUM ('hr', 'admin', 'manager', 'employee');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other');
CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract', 'intern');
CREATE TYPE check_in_method AS ENUM ('office_ip', 'web', 'mobile', 'biometric');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'half_day', 'late', 'early_departure', 'wfh');
CREATE TYPE leave_type AS ENUM ('CL', 'SL', 'EL', 'WFH', 'COMP_OFF', 'MATERNITY', 'PATERNITY', 'UNPAID');
CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'processed', 'paid');
CREATE TYPE reimbursement_type AS ENUM ('travel', 'food', 'medical', 'internet_phone', 'office_supplies', 'client_entertainment', 'other');
CREATE TYPE reimbursement_status AS ENUM ('pending', 'approved', 'rejected', 'paid');
CREATE TYPE training_mode AS ENUM ('online', 'offline', 'hybrid');
CREATE TYPE training_status AS ENUM ('scheduled', 'ongoing', 'completed', 'cancelled');
CREATE TYPE employee_training_status AS ENUM ('assigned', 'in_progress', 'completed', 'skipped');
CREATE TYPE announcement_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE announcement_audience AS ENUM ('all', 'hr', 'managers', 'employees');
CREATE TYPE holiday_type AS ENUM ('public', 'optional', 'restricted');
CREATE TYPE document_type AS ENUM ('offer_letter', 'joining_letter', 'aadhar', 'pan', 'educational_certificate', 'experience_letter', 'payslip', 'form_16', 'resignation_letter', 'relieving_letter');

-- Employees
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID UNIQUE,
  employee_code VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  date_of_birth DATE,
  gender gender_type,
  address JSONB DEFAULT '{}',
  role user_role NOT NULL DEFAULT 'employee',
  department VARCHAR(100),
  designation VARCHAR(100),
  manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  date_of_joining DATE,
  employment_type employment_type DEFAULT 'full_time',
  salary_details JSONB DEFAULT '{}',
  bank_details JSONB DEFAULT '{}',
  emergency_contact JSONB DEFAULT '{}',
  profile_picture VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employees_email ON employees(email);
CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_employees_role ON employees(role);
CREATE INDEX idx_employees_department ON employees(department);

-- Refresh tokens
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_employee ON refresh_tokens(employee_id);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leave balances
CREATE TABLE leave_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  leave_type leave_type NOT NULL,
  total_allocated DECIMAL(5,1) NOT NULL DEFAULT 0,
  used DECIMAL(5,1) NOT NULL DEFAULT 0,
  encashed DECIMAL(5,1) NOT NULL DEFAULT 0,
  UNIQUE(employee_id, year, leave_type)
);

-- Attendance
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in_time TIMESTAMPTZ NOT NULL,
  check_out_time TIMESTAMPTZ,
  check_in_method check_in_method NOT NULL DEFAULT 'web',
  check_out_method check_in_method,
  check_in_ip VARCHAR(45),
  check_out_ip VARCHAR(45),
  device_id VARCHAR(255),
  location JSONB,
  break_minutes INTEGER DEFAULT 0,
  total_hours DECIMAL(5,2),
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  status attendance_status DEFAULT 'present',
  remarks TEXT,
  is_auto_checkout BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attendance_employee ON attendance(employee_id);
CREATE INDEX idx_attendance_check_in ON attendance(check_in_time);
CREATE INDEX idx_attendance_active ON attendance(employee_id) WHERE check_out_time IS NULL;

-- Leaves
CREATE TABLE leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  total_days DECIMAL(4,1) NOT NULL,
  is_half_day BOOLEAN DEFAULT false,
  reason TEXT NOT NULL,
  status leave_status DEFAULT 'pending',
  manager_approved_by UUID REFERENCES employees(id),
  manager_approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leaves_employee ON leaves(employee_id);
CREATE INDEX idx_leaves_status ON leaves(status);
CREATE INDEX idx_leaves_dates ON leaves(from_date, to_date);

-- Payroll
CREATE TABLE payroll (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra DECIMAL(12,2) DEFAULT 0,
  special_allowance DECIMAL(12,2) DEFAULT 0,
  transport_allowance DECIMAL(12,2) DEFAULT 0,
  medical_allowance DECIMAL(12,2) DEFAULT 0,
  bonus DECIMAL(12,2) DEFAULT 0,
  overtime_pay DECIMAL(12,2) DEFAULT 0,
  gross_salary DECIMAL(12,2) DEFAULT 0,
  pf_deduction DECIMAL(12,2) DEFAULT 0,
  esi_deduction DECIMAL(12,2) DEFAULT 0,
  tds DECIMAL(12,2) DEFAULT 0,
  professional_tax DECIMAL(12,2) DEFAULT 0,
  leave_deduction DECIMAL(12,2) DEFAULT 0,
  other_deductions DECIMAL(12,2) DEFAULT 0,
  total_deductions DECIMAL(12,2) DEFAULT 0,
  net_salary DECIMAL(12,2) DEFAULT 0,
  payment_status payment_status DEFAULT 'pending',
  payment_date DATE,
  payslip_url VARCHAR(500),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

CREATE INDEX idx_payroll_employee ON payroll(employee_id);
CREATE INDEX idx_payroll_period ON payroll(year, month);

-- Payroll month workflow (v2)
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

-- Reimbursements
CREATE TABLE reimbursements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reimbursement_type reimbursement_type NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description TEXT NOT NULL,
  receipt_url VARCHAR(500),
  expense_date DATE NOT NULL,
  status reimbursement_status DEFAULT 'pending',
  manager_approved_by UUID REFERENCES employees(id),
  manager_approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES employees(id),
  approval_date TIMESTAMPTZ,
  payment_date DATE,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reimbursements_employee ON reimbursements(employee_id);
CREATE INDEX idx_reimbursements_status ON reimbursements(status);

-- Trainings
CREATE TABLE trainings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  trainer_name VARCHAR(255),
  training_mode training_mode NOT NULL DEFAULT 'online',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  duration_hours INTEGER,
  location VARCHAR(255),
  materials_url VARCHAR(500),
  status training_status DEFAULT 'scheduled',
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employee_trainings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  training_id UUID NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES employees(id),
  status employee_training_status DEFAULT 'assigned',
  completion_date TIMESTAMPTZ,
  feedback TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  certificate_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(training_id, employee_id)
);

-- Announcements
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  priority announcement_priority DEFAULT 'medium',
  target_audience announcement_audience DEFAULT 'all',
  department VARCHAR(100),
  attachment_url VARCHAR(500),
  published_by UUID REFERENCES employees(id),
  published_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE announcement_acknowledgements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, employee_id)
);

-- Holidays
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  type holiday_type NOT NULL DEFAULT 'public',
  description TEXT,
  region VARCHAR(100),
  is_mandatory BOOLEAN DEFAULT true,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_holidays_date ON holidays(date);
CREATE INDEX idx_holidays_year ON holidays((EXTRACT(YEAR FROM date)));

-- Documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type document_type NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  document_url VARCHAR(500) NOT NULL,
  uploaded_by UUID REFERENCES employees(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES employees(id),
  verified_at TIMESTAMPTZ
);

CREATE INDEX idx_documents_employee ON documents(employee_id);

-- System settings
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES employees(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update timestamps trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_attendance_updated BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_leaves_updated BEFORE UPDATE ON leaves FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payroll_updated BEFORE UPDATE ON payroll FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_reimbursements_updated BEFORE UPDATE ON reimbursements FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_trainings_updated BEFORE UPDATE ON trainings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_announcements_updated BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_holidays_updated BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Working hours calculation function
CREATE OR REPLACE FUNCTION calculate_working_hours(check_in TIMESTAMPTZ, check_out TIMESTAMPTZ, break_mins INTEGER DEFAULT 0)
RETURNS DECIMAL AS $$
BEGIN
  IF check_out IS NULL OR check_in IS NULL THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(0, ROUND(
    (EXTRACT(EPOCH FROM (check_out - check_in)) / 3600.0) - (break_mins / 60.0),
    2
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Leave balance initialization for new employee
CREATE OR REPLACE FUNCTION initialize_leave_balances()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO leave_balances (employee_id, year, leave_type, total_allocated, used)
  VALUES
    (NEW.id, EXTRACT(YEAR FROM NOW())::INTEGER, 'CL', 12, 0),
    (NEW.id, EXTRACT(YEAR FROM NOW())::INTEGER, 'SL', 12, 0),
    (NEW.id, EXTRACT(YEAR FROM NOW())::INTEGER, 'EL', 15, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_init_leave_balances AFTER INSERT ON employees FOR EACH ROW EXECUTE FUNCTION initialize_leave_balances();

-- Update leave balance on approval
CREATE OR REPLACE FUNCTION update_leave_balance_on_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE leave_balances
    SET used = used + NEW.total_days
    WHERE employee_id = NEW.employee_id
      AND year = EXTRACT(YEAR FROM NEW.from_date)::INTEGER
      AND leave_type = NEW.leave_type;
  END IF;
  IF OLD.status = 'approved' AND NEW.status IN ('rejected', 'cancelled') THEN
    UPDATE leave_balances
    SET used = GREATEST(0, used - OLD.total_days)
    WHERE employee_id = OLD.employee_id
      AND year = EXTRACT(YEAR FROM OLD.from_date)::INTEGER
      AND leave_type = OLD.leave_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leave_balance_update AFTER UPDATE ON leaves FOR EACH ROW EXECUTE FUNCTION update_leave_balance_on_approval();

-- Row Level Security (enable on all tables)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; backend uses service key
-- Seed default admin (password: Admin@123 - change after first login)
-- Password hash for 'Admin@123' with bcrypt 10 rounds - generate via backend

INSERT INTO system_settings (key, value) VALUES
  ('office_ip', '"182.69.179.236"'),
  ('office_cidr', '"182.69.179.236/32"'),
  ('work_hours', '9'),
  ('auto_checkout_time', '"04:00"'),
  ('timezone', '"Asia/Kolkata"'),
  ('allow_remote_login', 'false'),
  ('monthly_reimbursement_limit', '50000')
ON CONFLICT (key) DO NOTHING;
