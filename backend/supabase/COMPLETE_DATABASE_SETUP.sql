-- ============================================================================
-- COMPLETE DATABASE SETUP — HRMS
-- Generated 2026-08-28. For bootstrapping a FRESH / SEPARATE database only.
--
-- This is every .sql file that previously lived under backend/supabase/ and
-- backend/supabase/migrations/, concatenated in dependency order into one
-- file, each section still labeled with its original filename so the
-- history stays traceable. Paste this whole file into the SQL Editor of a
-- brand-new, empty Supabase/Postgres database and run it once, top to
-- bottom.
--
-- NOT for your current/existing database — that one is already partway
-- through this same history and has its own already-applied state (plus at
-- least one naming collision with pre-existing tables this file's later
-- sections don't know about). For the current database, keep using
-- backend/supabase/RUN_ALL_PENDING_MIGRATIONS.sql instead, which is written
-- to be safe to re-run against a partially-migrated database. Once that
-- file has been run successfully end to end, this one and that one describe
-- the same final schema and RUN_ALL_PENDING_MIGRATIONS.sql can be retired.
--
-- Order verified programmatically: every REFERENCES target and every custom
-- ENUM type is created before anything in this file uses it (checked
-- line-by-line across all 60 source files, not just file-by-file).
--
-- Source files, in the order they appear below:
--   01. schema.sql--   02. storage-policies.sql--   03. leave_types_v2.sql--   04. notifications.sql--   05. payroll_v2.sql--   06. training_v2.sql--   07. extended_modules.sql--   08. migrations/create_lms_tables.sql--   09. migrations/add_attendance_mode.sql--   10. migrations/add_attendance_status_wfh.sql--   11. migrations/create_wfh_day_requests.sql--   12. migrations/20260720_course_enrollment_archive.sql--   13. migrations/20260720_saas_phase1_companies_employees.sql--   14. migrations/20260720_saas_phase2_tenant_columns.sql--   15. migrations/20260721_employee_code_per_company.sql--   16. migrations/20260723_company_hierarchy.sql--   17. migrations/20260723_employee_code_emp001.sql--   18. migrations/20260723_api_keys.sql--   19. migrations/20260817_super_admin_onboarding_invites.sql--   20. migrations/20260820_must_change_password.sql--   21. migrations/20260821_adms_device_punches.sql--   22. migrations/20260821_device_employee_mapping.sql--   23. migrations/20260821_device_heartbeats_registry.sql--   24. migrations/20260821_device_heartbeats_company.sql--   25. migrations/20260825_device_punches_scope_dedup_by_device.sql--   26. migrations/20260826_course_enrollment_deadline.sql--   27. migrations/20260826_documents_company_id.sql--   28. migrations/20260826_employee_career_events.sql--   29. migrations/20260826_employee_email_per_company.sql--   30. migrations/20260826_onboarding_checklist.sql--   31. migrations/20260826_onboarding_invite_slug.sql--   32. migrations/20260826_recruitment_richer_fields.sql--   33. migrations/20260826_reimbursement_accommodation_type.sql--   34. migrations/20260826_super_admin_refresh_tokens.sql--   35. migrations/20260827_kb_categories_per_company.sql--   36. migrations/20260828_adms_device_secret.sql--   37. migrations/20260828_tenant_backstop_rls.sql--   38. migrations/20260829_api_keys_revoked_by.sql--   39. migrations/20260829_attendance_audit_columns.sql--   40. migrations/20260829_attendance_composite_index.sql--   41. migrations/20260829_career_events_bank_change_type.sql--   42. migrations/20260829_company_id_not_null.sql--   43. migrations/20260829_cron_locks.sql--   44. migrations/20260829_drop_employees_device_user_id.sql--   45. migrations/20260829_fix_mapping_lookup_index_order.sql--   46. migrations/20260829_kb_categories_backfill_safety.sql--   47. migrations/20260829_payroll_publish_audit.sql--   48. migrations/20260830_course_enrollments_unique.sql--   49. migrations/20260830_drop_leave_balance_trigger.sql--   50. migrations/20260830_employee_token_version.sql--   51. migrations/20260831_purge_stale_device_mappings.sql--   52. migrations/20260901_subscription_billing.sql--   53. migrations/20260902_employee_offboarding.sql--   54. migrations/20260903_install_prompt_seen.sql--   55. migrations/20260904_profile_self_edit_lock.sql--   56. migrations/20260905_onboarding_checklist_bank_details.sql--   57. migrations/20260906_course_enrollment_assigned_by.sql--   58. migrations/20260907_attendance_anomaly_alerts.sql--   59. migrations/20260908_audit_logs.sql--   60. migrations/20260909_backup_logs.sql-- ============================================================================


-- ============================================================================
-- PHASE 1 — Base schema (tables, enums, triggers, functions)
-- ============================================================================

-- ── 01/60 — schema.sql ────────────────────────────────────────────────────────────
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
  employee_code VARCHAR(20) NOT NULL, -- unique per company: UNIQUE(company_id, employee_code)
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
  must_change_password BOOLEAN NOT NULL DEFAULT false,
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

-- Service role bypasses RLS; backend uses service key.
-- No default admin is seeded by this schema — the real onboarding path is
-- the super-admin invite flow (see superAdmin.service.js / auth.service.js
-- bootstrapAdmin), which creates the first company + admin account.

INSERT INTO system_settings (key, value) VALUES
  ('office_ip', '"182.69.179.236"'),
  ('office_cidr', '"182.69.179.236/32"'),
  ('work_hours', '9'),
  ('auto_checkout_time', '"04:00"'),
  ('timezone', '"Asia/Kolkata"'),
  ('allow_remote_login', 'false'),
  ('monthly_reimbursement_limit', '50000')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- PHASE 2 — Original feature modules (leave v2, payroll v2, training v2, notifications, storage policies, recruitment/performance/helpdesk/assets, LMS)
-- ============================================================================

-- ── 02/60 — storage-policies.sql ──────────────────────────────────────────────────
-- Supabase Storage Buckets Setup
-- Run in Supabase SQL Editor after creating buckets in Dashboard

-- Create buckets via Dashboard: Storage > New Bucket
-- Buckets: documents, receipts, training-materials, profile-pictures, payslips
-- Set all as PRIVATE

-- Storage policies (service role bypasses; these are for direct client access if needed)
--
-- Audit finding N-11: the original policies below only checked bucket_id —
-- no ownership predicate at all — so as written they granted read/write on
-- an ENTIRE bucket's contents to any accessor, not just the resource
-- owner. Same architectural caveat as the H-05 table-RLS migration: this
-- backend exclusively uses supabaseAdmin (service_role), which bypasses
-- all of this unconditionally, so these predicates are currently inert for
-- the app itself. They still matter the moment any future client (a
-- mobile app, a direct-to-Storage upload widget, anything using a
-- Supabase anon/authenticated key instead of going through this backend)
-- is ever given a Supabase key — real ownership predicates now mean that
-- path is at least scoped correctly on day one instead of granting
-- cross-tenant/cross-employee access by default.
--
-- Every upload in this app is namespaced with the owning employee's id as
-- the first path segment (documents/receipts/profile-pictures:
-- "{employeeId}/{uuid}.ext"; payslips: "{employeeId}/{year}-{month}.pdf" —
-- see storage.service.js's uploadFile/uploadPayslip), so
-- (storage.foldername(name))[1] is that employee id. There is no
-- Supabase-Auth session in this app (auth.uid() is never populated — this
-- backend has its own JWT system), so ownership/role are read from custom
-- settings mirroring app.company_id's pattern from the H-05 migration:
-- app.employee_id and app.role. Exactly like app.company_id, nothing in
-- this codebase calls set_config for these today — same known, documented
-- gap, not a new one.

-- Documents bucket — owner (their own employeeId-prefixed files) or HR/Admin (company-wide review)
DROP POLICY IF EXISTS "HR can read all documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users upload own documents" ON storage.objects;

CREATE POLICY "Documents readable by owner or HR/Admin"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents' AND (
    (storage.foldername(name))[1] = current_setting('app.employee_id', true)
    OR current_setting('app.role', true) IN ('hr', 'admin')
  )
);

CREATE POLICY "Documents uploadable only into your own folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = current_setting('app.employee_id', true)
);

-- Receipts bucket — owner only (reimbursement receipts are personal, not HR-browsable via Storage directly)
DROP POLICY IF EXISTS "Users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own receipts" ON storage.objects;

CREATE POLICY "Receipts uploadable only into your own folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] = current_setting('app.employee_id', true)
);

CREATE POLICY "Receipts readable by owner or HR/Admin"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'receipts' AND (
    (storage.foldername(name))[1] = current_setting('app.employee_id', true)
    OR current_setting('app.role', true) IN ('hr', 'admin')
  )
);

-- Payslips bucket — owner only for reads; writes are HR/Admin-only (payroll generation/publish)
DROP POLICY IF EXISTS "Service uploads payslips" ON storage.objects;
DROP POLICY IF EXISTS "Employees read payslips" ON storage.objects;

CREATE POLICY "Payslips uploadable only by HR/Admin"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'payslips'
  AND current_setting('app.role', true) IN ('hr', 'admin')
);

CREATE POLICY "Payslips readable by owner or HR/Admin"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'payslips' AND (
    (storage.foldername(name))[1] = current_setting('app.employee_id', true)
    OR current_setting('app.role', true) IN ('hr', 'admin')
  )
);

-- ── 03/60 — leave_types_v2.sql ────────────────────────────────────────────────────
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

-- ── 04/60 — notifications.sql ─────────────────────────────────────────────────────
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

-- ── 05/60 — payroll_v2.sql ────────────────────────────────────────────────────────
-- Payroll v2: month workflow + draft/publish payslips
-- Run this in Supabase SQL editor if payroll_months does not exist yet.

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

-- ── 06/60 — training_v2.sql ───────────────────────────────────────────────────────
-- Training v2: Course -> Chapter -> Lesson (run in Supabase SQL editor)

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  thumbnail_key VARCHAR(500),
  target_departments TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_chapters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  "order" INTEGER NOT NULL,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_chapters_course ON course_chapters(course_id);

CREATE TABLE IF NOT EXISTS lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  chapter_id UUID NOT NULL REFERENCES course_chapters(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('VIDEO_UPLOAD', 'EXTERNAL_LINK')),
  video_key VARCHAR(500),
  external_link VARCHAR(1000),
  video_duration FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_chapter ON lessons(chapter_id);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'IN_PROGRESS',
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(employee_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_employee ON course_enrollments(employee_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  enrollment_id UUID NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  watched_seconds FLOAT DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  UNIQUE(enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_enrollment ON lesson_progress(enrollment_id);

CREATE TRIGGER trg_courses_updated
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 07/60 — extended_modules.sql ──────────────────────────────────────────────────
-- Extended HRMS modules: Assets, Performance, Recruitment, Helpdesk
-- Run in Supabase SQL Editor after schema.sql

CREATE TABLE IF NOT EXISTS asset_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  brand VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  purchase_date DATE,
  purchase_cost NUMERIC(12,2) DEFAULT 0,
  warranty_expiry DATE,
  status VARCHAR(50) DEFAULT 'available',
  assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,
  assigned_on DATE,
  location VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  asset_type VARCHAR(100) NOT NULL,
  reason TEXT,
  urgency VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(50) DEFAULT 'requested',
  requested_on DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  start_date DATE,
  end_date DATE,
  participants INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  cycle VARCHAR(100),
  progress INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'on_track',
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  cycle_id UUID REFERENCES review_cycles(id) ON DELETE SET NULL,
  score NUMERIC(3,1),
  status VARCHAR(50) DEFAULT 'pending',
  progress INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_openings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  department VARCHAR(100),
  location VARCHAR(200),
  employment_type employment_type DEFAULT 'full_time',
  status VARCHAR(50) DEFAULT 'open',
  openings INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES job_openings(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(255),
  stage VARCHAR(50) DEFAULT 'applied',
  days_in_stage INT DEFAULT 0,
  applied_on DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID REFERENCES job_openings(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  interviewer VARCHAR(200),
  status VARCHAR(50) DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID REFERENCES job_openings(id) ON DELETE SET NULL,
  amount NUMERIC(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  offered_on DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raised_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  subject VARCHAR(500) NOT NULL,
  category VARCHAR(100) DEFAULT 'it',
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(50) DEFAULT 'open',
  description TEXT,
  assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  sla_due_by TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS helpdesk_ticket_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID REFERENCES helpdesk_tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_categories (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  article_count INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(50) REFERENCES kb_categories(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  content TEXT,
  views INT DEFAULT 0,
  updated_on DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default KB categories
INSERT INTO kb_categories (id, name, article_count) VALUES
  ('it', 'IT Setup', 0),
  ('payroll', 'Payroll FAQs', 0),
  ('leave', 'Leave Policies', 0),
  ('benefits', 'Benefits', 0),
  ('onboarding', 'Onboarding', 0)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_assets_assigned ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_asset_requests_employee ON asset_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_performance_goals_employee ON performance_goals(employee_id);
CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_raised ON helpdesk_tickets(raised_by);

-- ============================================================================
-- PHASE 3 — Early standalone migrations (WFH support, one-off fixes)
-- ============================================================================

-- ── 08/60 — migrations/create_lms_tables.sql ──────────────────────────────────────
-- LMS (Coursera/Udemy-style) — flat Course → Lessons model
-- FK table is `employees` (this project does not use a `users` table).
-- Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS / additive alters).
-- No Prisma — raw PostgreSQL only.

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  thumbnail_key TEXT,
  target_departments TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS target_departments TEXT[] DEFAULT '{}';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id) ON DELETE SET NULL;

UPDATE courses
SET status = CASE WHEN COALESCE(is_active, true) THEN 'ACTIVE' ELSE 'ARCHIVED' END
WHERE status IS NULL OR status NOT IN ('ACTIVE', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- course_lessons (flat; no chapters)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lesson_order INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('VIDEO_UPLOAD', 'EXTERNAL_LINK')),
  video_url TEXT,
  video_key TEXT,
  external_link TEXT,
  video_duration FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_course ON course_lessons(course_id);

-- ---------------------------------------------------------------------------
-- course_enrollments
-- user_id = employee id (REFERENCES employees). employee_id kept for legacy rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE CASCADE;

UPDATE course_enrollments SET user_id = employee_id WHERE user_id IS NULL AND employee_id IS NOT NULL;
UPDATE course_enrollments SET employee_id = user_id WHERE employee_id IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_employee ON course_enrollments(employee_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);

-- ---------------------------------------------------------------------------
-- course_progress (anti-skip tracker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  watched_seconds FLOAT DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  UNIQUE (enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_course_progress_enrollment ON course_progress(enrollment_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_courses_updated ON courses;
    CREATE TRIGGER trg_courses_updated
      BEFORE UPDATE ON courses
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ── 09/60 — migrations/add_attendance_mode.sql ────────────────────────────────────
-- Per-employee attendance / check-in mode
-- office = must check in from office IP whitelist
-- wfh    = allowed from any network

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) NOT NULL DEFAULT 'office';

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_attendance_mode_check;

ALTER TABLE employees
  ADD CONSTRAINT employees_attendance_mode_check
  CHECK (attendance_mode IN ('office', 'wfh'));

COMMENT ON COLUMN employees.attendance_mode IS 'office = require office IP for check-in; wfh = any network allowed';

-- ── 10/60 — migrations/add_attendance_status_wfh.sql ──────────────────────────────
-- Allow attendance.status = 'wfh' for work-from-home check-ins
ALTER TYPE attendance_status ADD VALUE IF NOT EXISTS 'wfh';

-- ── 11/60 — migrations/create_wfh_day_requests.sql ────────────────────────────────
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

-- ============================================================================
-- PHASE 4 — Multi-tenant SaaS conversion + per-day migrations (2026-07-20 through 2026-08-26)
-- ============================================================================

-- ── 12/60 — migrations/20260720_course_enrollment_archive.sql ─────────────────────
-- HR can archive completed enrollments to declutter the tracking dashboard.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_archived ON course_enrollments(is_archived);

-- ── 13/60 — migrations/20260720_saas_phase1_companies_employees.sql ───────────────
-- =============================================================================
-- MULTI-TENANT SaaS — Phase 1 (FIXED)
-- Run in Supabase SQL Editor.
-- Fixes: employees already have address.company_id from onboarding that are
-- NOT in companies yet — we upsert those companies BEFORE adding the FK.
-- =============================================================================

-- 1) Companies master table (no dependency yet)
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fixed UUID used by the app as DEFAULT_COMPANY_ID
INSERT INTO companies (id, name, slug, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Company',
  'default',
  true
)
ON CONFLICT (id) DO NOTHING;

-- 2) Add employees.company_id WITHOUT foreign key first (safe)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS company_id UUID;

-- 3) Backfill from JSON address (or default)
UPDATE employees
SET company_id = COALESCE(
  NULLIF(address->>'company_id', '')::uuid,
  NULLIF(address->>'companyId', '')::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

-- 4) Create any missing company rows that employees already reference
--    (from previous /onboarding runs that only wrote address.company_id)
INSERT INTO companies (id, name, slug, is_active)
SELECT DISTINCT
  e.company_id,
  COALESCE(
    (
      SELECT NULLIF(trim(emp.first_name || ' ' || emp.last_name), '')
      FROM employees emp
      WHERE emp.company_id = e.company_id
        AND emp.role = 'admin'
      ORDER BY emp.created_at ASC NULLS LAST
      LIMIT 1
    ),
    'Company ' || LEFT(e.company_id::text, 8)
  ),
  'co-' || REPLACE(e.company_id::text, '-', ''),
  true
FROM employees e
WHERE e.company_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = e.company_id)
ON CONFLICT (id) DO NOTHING;

-- Also catch any JSON ids not yet copied into the column
INSERT INTO companies (id, name, slug, is_active)
SELECT DISTINCT
  (NULLIF(address->>'company_id', '')::uuid),
  'Company ' || LEFT(NULLIF(address->>'company_id', ''), 8),
  'co-' || REPLACE(NULLIF(address->>'company_id', ''), '-', ''),
  true
FROM employees
WHERE NULLIF(address->>'company_id', '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM companies c
    WHERE c.id = (NULLIF(employees.address->>'company_id', '')::uuid)
  )
ON CONFLICT (id) DO NOTHING;

-- 5) Keep JSON address.company_id in sync
UPDATE employees
SET address = jsonb_set(
  COALESCE(address, '{}'::jsonb),
  '{company_id}',
  to_jsonb(company_id::text),
  true
)
WHERE company_id IS NOT NULL
  AND (address->>'company_id' IS DISTINCT FROM company_id::text);

-- 6) Defaults + NOT NULL
ALTER TABLE employees
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

UPDATE employees
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE employees
  ALTER COLUMN company_id SET NOT NULL;

-- 7) Add FK only AFTER every company_id exists in companies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_company_id_fkey'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);

-- Verify
SELECT id, name, slug FROM companies ORDER BY created_at;
SELECT company_id, COUNT(*) AS employees FROM employees GROUP BY company_id;
SELECT email, company_id, address->>'company_id' AS address_company
FROM employees
WHERE email IN ('admin@company.com', 'hr1@company.com')
   OR role = 'admin'
ORDER BY email;

-- ── 14/60 — migrations/20260720_saas_phase2_tenant_columns.sql ────────────────────
-- =============================================================================
-- MULTI-TENANT SaaS — Phase 2 (run AFTER Phase 1)
-- Adds company_id to shared tables + backfills to default company.
-- Fixes payroll_months unique so each company can run the same month.
-- =============================================================================

-- Helper: default company
-- '00000000-0000-0000-0000-000000000001'

-- ---------- payroll_months (CRITICAL) ----------
ALTER TABLE payroll_months
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE payroll_months
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE payroll_months
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE payroll_months
  ALTER COLUMN company_id SET NOT NULL;

-- Drop old global unique (month, year) if it exists, replace with per-company
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payroll_months_month_year_key'
  ) THEN
    ALTER TABLE payroll_months DROP CONSTRAINT payroll_months_month_year_key;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- Also try common auto names
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'payroll_months'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%month%'
      AND pg_get_constraintdef(c.oid) ILIKE '%year%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%company_id%'
  LOOP
    EXECUTE format('ALTER TABLE payroll_months DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_months_company_month_year
  ON payroll_months (company_id, month, year);

CREATE INDEX IF NOT EXISTS idx_payroll_months_company ON payroll_months(company_id);

-- ---------- payroll_components ----------
ALTER TABLE payroll_components
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE payroll_components
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE payroll_components
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_payroll_components_company ON payroll_components(company_id);

-- ---------- announcements ----------
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE announcements a
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = a.published_by),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

ALTER TABLE announcements
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_announcements_company ON announcements(company_id);

-- ---------- holidays ----------
ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE holidays h
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = h.created_by),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

ALTER TABLE holidays
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_holidays_company ON holidays(company_id);

-- ---------- assets ----------
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE assets a
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = a.assigned_to),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

ALTER TABLE assets
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_assets_company ON assets(company_id);

-- ---------- asset_categories ----------
ALTER TABLE asset_categories
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE asset_categories
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE asset_categories
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_asset_categories_company ON asset_categories(company_id);

-- ---------- asset_requests (optional; already scoped via employee) ----------
ALTER TABLE asset_requests
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE asset_requests r
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = r.employee_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_asset_requests_company ON asset_requests(company_id);

-- ---------- recruitment ----------
ALTER TABLE job_openings
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE job_openings
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE job_openings
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_job_openings_company ON job_openings(company_id);

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE candidates c
SET company_id = COALESCE(
  (SELECT j.company_id FROM job_openings j WHERE j.id = c.job_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_company ON candidates(company_id);

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE interviews i
SET company_id = COALESCE(
  (SELECT c.company_id FROM candidates c WHERE c.id = i.candidate_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_interviews_company ON interviews(company_id);

ALTER TABLE job_offers
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE job_offers o
SET company_id = COALESCE(
  (SELECT c.company_id FROM candidates c WHERE c.id = o.candidate_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_offers_company ON job_offers(company_id);

-- ---------- performance ----------
ALTER TABLE review_cycles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE review_cycles
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE review_cycles
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_review_cycles_company ON review_cycles(company_id);

-- ---------- LMS courses (if table exists) ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'courses') THEN
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
    UPDATE courses SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
    ALTER TABLE courses ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
    CREATE INDEX IF NOT EXISTS idx_courses_company ON courses(company_id);
  END IF;
END $$;

-- ---------- helpdesk / KB ----------
ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE helpdesk_tickets t
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = t.raised_by),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_company ON helpdesk_tickets(company_id);

-- KB categories use string id — keep shared seed for default; new companies get their own later via code
ALTER TABLE kb_articles
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

UPDATE kb_articles
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE kb_articles
  ALTER COLUMN company_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS idx_kb_articles_company ON kb_articles(company_id);

-- Verify samples
-- SELECT 'payroll_months' AS t, company_id, COUNT(*) FROM payroll_months GROUP BY 1,2
-- UNION ALL SELECT 'job_openings', company_id, COUNT(*) FROM job_openings GROUP BY 1,2
-- UNION ALL SELECT 'assets', company_id, COUNT(*) FROM assets GROUP BY 1,2;

-- ── 15/60 — migrations/20260721_employee_code_per_company.sql ─────────────────────
-- Per-company sequential employee codes: EMP01, EMP02, … (unique within company)

-- 1) Allow the same code in different companies
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employee_code_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employees_company_id_employee_code_key'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_company_id_employee_code_key
      UNIQUE (company_id, employee_code);
  END IF;
END $$;

-- 2) Atomic sequence counter on companies
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS employee_code_seq INTEGER NOT NULL DEFAULT 0;

-- Backfill from highest existing EMP## per company (non-EMP codes ignored)
UPDATE companies c
SET employee_code_seq = COALESCE((
  SELECT MAX(
    CASE
      WHEN e.employee_code ~* '^EMP[0-9]+$'
        THEN NULLIF(regexp_replace(e.employee_code, '^EMP', '', 'i'), '')::INTEGER
      ELSE 0
    END
  )
  FROM employees e
  WHERE e.company_id = c.id
), 0);

-- 3) Allocate next code atomically
CREATE OR REPLACE FUNCTION next_employee_code(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE companies
  SET
    employee_code_seq = employee_code_seq + 1,
    updated_at = NOW()
  WHERE id = p_company_id
  RETURNING employee_code_seq INTO n;

  IF n IS NULL THEN
    RAISE EXCEPTION 'Company not found: %', p_company_id;
  END IF;

  RETURN 'EMP' || lpad(n::text, GREATEST(2, length(n::text)), '0');
END;
$$;

-- ── 16/60 — migrations/20260723_company_hierarchy.sql ─────────────────────────────
-- =============================================================================
-- Parent / child company hierarchy
-- Admin of a parent (or standalone that becomes parent) can create child companies.
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS parent_company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS company_type VARCHAR(20) NOT NULL DEFAULT 'standalone';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_company_type_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_company_type_check
      CHECK (company_type IN ('standalone', 'parent', 'child'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_parent_company_id
  ON companies (parent_company_id)
  WHERE parent_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_company_type
  ON companies (company_type);

-- Children must have a parent; parents/standalones must not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_parent_child_consistency'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_parent_child_consistency
      CHECK (
        (company_type = 'child' AND parent_company_id IS NOT NULL)
        OR (company_type IN ('standalone', 'parent') AND parent_company_id IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN companies.parent_company_id IS 'Set only for child companies; points to parent tenant';
COMMENT ON COLUMN companies.company_type IS 'standalone | parent | child';

-- ── 17/60 — migrations/20260723_employee_code_emp001.sql ──────────────────────────
-- Employee codes: EMP001, EMP002, … per company (3-digit pad, grows after 999)

CREATE OR REPLACE FUNCTION next_employee_code(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE companies
  SET
    employee_code_seq = employee_code_seq + 1,
    updated_at = NOW()
  WHERE id = p_company_id
  RETURNING employee_code_seq INTO n;

  IF n IS NULL THEN
    RAISE EXCEPTION 'Company not found: %', p_company_id;
  END IF;

  -- EMP001 … EMP999, then EMP1000, EMP1001, …
  RETURN 'EMP' || lpad(n::text, GREATEST(3, length(n::text)), '0');
END;
$$;

-- Realign counter to highest existing EMP#### in each company
-- (fixes inflated seq from old random seed codes)
UPDATE companies c
SET employee_code_seq = COALESCE((
  SELECT MAX(
    CASE
      WHEN e.employee_code ~* '^EMP[0-9]+$'
        THEN NULLIF(regexp_replace(e.employee_code, '^EMP', '', 'i'), '')::INTEGER
      ELSE 0
    END
  )
  FROM employees e
  WHERE e.company_id = c.id
), 0),
updated_at = NOW();

COMMENT ON FUNCTION next_employee_code(UUID) IS
  'Returns next per-company employee code: EMP001, EMP002, …';

-- ── 18/60 — migrations/20260723_api_keys.sql ──────────────────────────────────────
-- =============================================================================
-- Company-scoped API keys for B2B integrations (biometric, reporting, etc.)
-- Store ONLY a hash of the key — never the plaintext secret.
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  -- Visible fragment for UI + fast lookup (e.g. hrms_live_a1b2)
  key_prefix VARCHAR(24) NOT NULL,
  -- SHA-256 hex of the full key (never store plaintext)
  key_hash VARCHAR(64) NOT NULL,
  -- live | test
  environment VARCHAR(10) NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live', 'test')),
  -- e.g. ["attendance:write", "employees:read"]
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_company_id ON api_keys (company_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_company_active
  ON api_keys (company_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE api_keys IS 'Integration API keys; only key_hash is stored, never plaintext';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hex digest of the full API key';
COMMENT ON COLUMN api_keys.key_prefix IS 'Short public prefix shown in UI and used for lookup';

-- ── 19/60 — migrations/20260817_super_admin_onboarding_invites.sql ────────────────
-- Super Admin portal + one-time company onboarding invites
-- Run in Supabase SQL Editor after previous migrations.

CREATE TABLE IF NOT EXISTS super_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name VARCHAR(200),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  email VARCHAR(255),
  company_name_hint VARCHAR(200),
  created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_invites_active
  ON onboarding_invites (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE super_admins IS 'Platform operators — not company employees';
COMMENT ON TABLE onboarding_invites IS 'One-time links required to create a new company workspace';

-- ── 20/60 — migrations/20260820_must_change_password.sql ──────────────────────────
-- Require password change after first login with a temporary password.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN employees.must_change_password IS
  'When true, user must set a new password before using the app (temp password from welcome email).';

-- ── 21/60 — migrations/20260821_adms_device_punches.sql ───────────────────────────
-- =============================================================================
-- ADMS biometric integration (eSSL X2008 push protocol)
-- Raw punch log from the device. Intentionally separate from the existing
-- `attendance` table (daily check-in/check-out records computed elsewhere) —
-- this is a per-scan log, not a daily summary.
-- =============================================================================

CREATE TABLE IF NOT EXISTS device_punches (
  id BIGSERIAL PRIMARY KEY,
  device_user_id TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  punch_type TEXT NOT NULL CHECK (punch_type IN ('checkin', 'checkout', 'overtime_in', 'overtime_out', 'unknown')),
  verify_mode TEXT,
  device_serial TEXT,
  raw_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_user_id, punch_time)
);

CREATE INDEX IF NOT EXISTS idx_device_punches_employee ON device_punches(employee_id);
CREATE INDEX IF NOT EXISTS idx_device_punches_company_time ON device_punches(company_id, punch_time DESC);
CREATE INDEX IF NOT EXISTS idx_device_punches_punch_time ON device_punches(punch_time DESC);

-- Tracks the last time each physical device was heard from (heartbeat or punch),
-- so /adms/test can report connection status without holding in-memory state
-- (the API can run as more than one instance).
CREATE TABLE IF NOT EXISTS device_heartbeats (
  device_serial TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps a device's local user id (e.g. fingerprint enrollment id) to an employee.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS device_user_id TEXT UNIQUE;

-- ── 22/60 — migrations/20260821_device_employee_mapping.sql ───────────────────────
-- Mapping table between eSSL device local user IDs (simple numbers) and
-- HRMS employee UUIDs. Scoped by device_serial so the same numeric ID can
-- be reused across different physical devices without colliding.
CREATE TABLE IF NOT EXISTS device_employee_mapping (
  id BIGSERIAL PRIMARY KEY,
  device_user_id TEXT NOT NULL,
  device_serial TEXT NOT NULL DEFAULT 'NFZ8244800715',
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_user_id, device_serial)
);

-- Index for fast lookup on every punch
CREATE INDEX IF NOT EXISTS idx_mapping_lookup
  ON device_employee_mapping(device_user_id, device_serial);

-- ── 23/60 — migrations/20260821_device_heartbeats_registry.sql ────────────────────
-- Let HR/Admin label a device (friendly name + location) from the frontend,
-- on top of the last_seen_at heartbeat data already recorded by /iclock/*.
ALTER TABLE device_heartbeats
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT;

-- ── 24/60 — migrations/20260821_device_heartbeats_company.sql ─────────────────────
-- Multi-tenant device ownership: a device is "claimed" by whichever company
-- first registers its serial from the frontend. Unclaimed heartbeats
-- (company_id IS NULL) are visible to nobody until claimed.
ALTER TABLE device_heartbeats
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS idx_device_heartbeats_company ON device_heartbeats(company_id);

-- ── 25/60 — migrations/20260825_device_punches_scope_dedup_by_device.sql ──────────
-- The punch de-dup key was (device_user_id, punch_time) with no device scoping.
-- Device installers commonly number users starting at 1, so two different
-- companies' devices can both have a "user 5" — if those two people punch at
-- the exact same timestamp, the second company's genuine punch silently
-- upserts over (and is dropped by) the first. Scope the constraint to the
-- physical device serial too, matching device_employee_mapping's own key.
ALTER TABLE device_punches DROP CONSTRAINT IF EXISTS device_punches_device_user_id_punch_time_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_punches_serial_user_time_key'
  ) THEN
    ALTER TABLE device_punches ADD CONSTRAINT device_punches_serial_user_time_key
      UNIQUE (device_serial, device_user_id, punch_time);
  END IF;
END $$;

-- ── 26/60 — migrations/20260826_course_enrollment_deadline.sql ────────────────────
-- The "Assign Course" modal already captures a deadline date; it had nowhere
-- to be stored. Run in Supabase SQL Editor.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS deadline DATE;

-- ── 27/60 — migrations/20260826_documents_company_id.sql ──────────────────────────
-- The `documents` table had no company_id at all — the "All Documents" admin
-- view queried across every tenant (capped at 5000 rows) and filtered
-- afterward, so a quieter tenant's older documents could get pushed out of
-- that window and vanish from their own view. Run in Supabase SQL Editor.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- Backfill from each document's own employee.
UPDATE documents d
SET company_id = e.company_id
FROM employees e
WHERE d.employee_id = e.id
  AND d.company_id IS NULL;

-- Any row whose employee no longer exists (employee deleted, doc orphaned)
-- falls back to the platform's default tenant — the same fixed UUID the
-- application code uses everywhere else (backend/src/utils/tenant.js).
UPDATE documents
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE documents ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);

-- ── 28/60 — migrations/20260826_employee_career_events.sql ────────────────────────
-- Real career-history tracking. Career Timeline previously only ever
-- rendered one synthetic "Joined as {designation}" entry with nothing
-- behind it. Events are created two ways: automatically when HR edits an
-- employee's designation/department/manager/salary, and manually via an
-- "Add Career Note" action for anything that isn't a tracked field change.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS employee_career_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
    'joined', 'designation_change', 'department_change', 'manager_change',
    'salary_change', 'note'
  )),
  from_value TEXT,
  to_value TEXT,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_career_events_employee ON employee_career_events(employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_career_events_company ON employee_career_events(company_id);

-- ── 29/60 — migrations/20260826_employee_email_per_company.sql ────────────────────
-- The actual root cause of "one employee's email can only ever exist at one
-- company, platform-wide": employees.email was UNIQUE across the entire
-- database, not per company. A new hire, a brand-new company signing up, or
-- HR adding staff all got rejected as "already exists" the moment their
-- email happened to match an unrelated tenant's record anywhere on the
-- platform. Every existing email is already globally unique today (that was
-- the old constraint), so this migration is safe to run with no data
-- cleanup — it can only ever loosen the constraint, never violate it.
-- Run in Supabase SQL Editor.

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_key;
ALTER TABLE employees ADD CONSTRAINT employees_company_id_email_key UNIQUE (company_id, email);

-- ── 30/60 — migrations/20260826_onboarding_checklist.sql ──────────────────────────
-- Onboarding Checklist was five hardcoded checkboxes with no state handler,
-- API, or backing table — checking them was inert and reset on reload. This
-- makes it real and admin-configurable, the same shape as Document Types:
-- a per-company template list HR can add/remove/reorder, and a per-candidate
-- checked-state table. Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS onboarding_checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  label VARCHAR(200) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, label)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_templates_company ON onboarding_checklist_templates(company_id, sort_order);

-- Seed every existing company with the same 5 items the old hardcoded UI had,
-- so behavior looks identical on day one before any admin customizes it.
INSERT INTO onboarding_checklist_templates (company_id, label, sort_order)
SELECT c.id, item.label, item.sort_order
FROM companies c
CROSS JOIN (VALUES
  ('Create employee record', 0),
  ('Assign work email & laptop', 1),
  ('Send welcome kit', 2),
  ('Schedule orientation', 3),
  ('Add to payroll', 4)
) AS item(label, sort_order)
ON CONFLICT (company_id, label) DO NOTHING;

CREATE TABLE IF NOT EXISTS onboarding_checklist_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES onboarding_checklist_templates(id) ON DELETE CASCADE,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  checked_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ,
  UNIQUE (candidate_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_status_candidate ON onboarding_checklist_status(candidate_id);

-- ── 31/60 — migrations/20260826_onboarding_invite_slug.sql ────────────────────────
-- Subdomain-per-tenant: the company's subdomain is now locked in at invite
-- creation time (super admin picks/edits an auto-suggested slug), so it's
-- ready the moment the invited admin finishes onboarding instead of getting
-- a meaningless co-{uuid} slug. Run in Supabase SQL Editor.
ALTER TABLE onboarding_invites ADD COLUMN IF NOT EXISTS company_slug VARCHAR(63);

-- ── 32/60 — migrations/20260826_recruitment_richer_fields.sql ─────────────────────
-- Recruitment had no way to create a candidate, interview, or offer through
-- the API or UI at all — only move existing (manually seeded) ones between
-- stages. Adding real create flows with fields recruiters actually need.
-- Run in Supabase SQL Editor.

-- job_openings.company_id already exists (added in 20260720_saas_phase2_tenant_columns.sql).
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_url VARCHAR(500);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS source VARCHAR(50);

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'video';
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS round INT DEFAULT 1;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS panel TEXT;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS feedback TEXT;

ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR';
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS designation VARCHAR(150);
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS joining_date DATE;

-- ── 33/60 — migrations/20260826_reimbursement_accommodation_type.sql ──────────────
-- "Accommodation" and "Other" reimbursements were indistinguishable in
-- reports because both mapped to the same 'other' enum value. Add a real
-- value. Run in Supabase SQL Editor (must run as its own statement, not
-- combined into an explicit transaction, and any later statement that
-- reads the new value must be a separate run — plain SQL Editor execution
-- of this whole file satisfies that).
ALTER TYPE reimbursement_type ADD VALUE IF NOT EXISTS 'accommodation';

-- ── 34/60 — migrations/20260826_super_admin_refresh_tokens.sql ────────────────────
-- Refresh-token storage for platform Super Admin sessions.
-- Mirrors `refresh_tokens` (employee sessions): only a hash is stored, and the
-- refresh endpoint rotates it (old row deleted the instant a new token is issued).
-- Run in Supabase SQL Editor after previous migrations.

CREATE TABLE IF NOT EXISTS super_admin_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_refresh_tokens_admin
  ON super_admin_refresh_tokens(super_admin_id);

COMMENT ON TABLE super_admin_refresh_tokens IS 'Hashed refresh tokens for super admin sessions — the 24h access token can be renewed without a full re-login';

-- ============================================================================
-- PHASE 5 — This session's fixes & new features (2026-08-27 through 2026-09-09)
-- ============================================================================

-- ── 35/60 — migrations/20260827_kb_categories_per_company.sql ─────────────────────
-- kb_categories was a single global table shared by primary key across every
-- tenant — the multi-tenant migration itself left a comment acknowledging
-- this and never came back to fix it. Turns out the table is empty in
-- production today (nothing ever seeded it), so there's no data to migrate —
-- just widen the key before any create/rename/delete feature gets built on
-- top of the unscoped shape by mistake. The app now seeds this table
-- per-company itself (see helpdesk.service.js's ensureKbCategoriesSeeded).
-- Run in Supabase SQL Editor.
--
-- Fixed 2026-08-28: the original version of this migration dropped
-- kb_categories_pkey directly, which failed live —
-- kb_articles_category_fkey depends on that PK's index (kb_articles.category
-- references kb_categories.id), so Postgres refuses to drop it without
-- CASCADE. Blindly using CASCADE would silently drop that FK and never put
-- it back. This version captures the FK's exact definition first, drops it,
-- widens the PK, adds a standalone UNIQUE(id) so kb_articles.category can
-- keep referencing just kb_categories(id) without kb_articles needing a
-- company_id column of its own, then recreates the FK from the captured
-- definition — so ON DELETE/UPDATE behavior etc. comes back exactly as it
-- was, not guessed. Wrapped in one DO block so it's atomic: either the whole
-- transition succeeds, or none of it applies (matches the rollback that
-- already happened when the original version failed partway through).
DO $$
DECLARE
  fk_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO fk_def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'kb_articles' AND c.conname = 'kb_articles_category_fkey';

  IF fk_def IS NOT NULL THEN
    ALTER TABLE kb_articles DROP CONSTRAINT kb_articles_category_fkey;
  END IF;

  ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
  ALTER TABLE kb_categories ALTER COLUMN company_id SET NOT NULL;
  ALTER TABLE kb_categories DROP CONSTRAINT IF EXISTS kb_categories_pkey;
  ALTER TABLE kb_categories ADD PRIMARY KEY (company_id, id);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_categories_id_key') THEN
    ALTER TABLE kb_categories ADD CONSTRAINT kb_categories_id_key UNIQUE (id);
  END IF;

  IF fk_def IS NOT NULL THEN
    EXECUTE format('ALTER TABLE kb_articles ADD CONSTRAINT kb_articles_category_fkey %s', fk_def);
  END IF;
END $$;

-- ── 36/60 — migrations/20260828_adms_device_secret.sql ────────────────────────────
-- ADMS security hardening (audit finding C-01): the eSSL push protocol has
-- no auth of its own, so device_heartbeats.company_id (set via
-- registerDevice) is already the primary gate — an unclaimed serial is
-- rejected outright by assertDeviceAuthorized() in adms.service.js.
-- device_secret is an OPTIONAL second factor: when an admin sets one for a
-- device, every /iclock/cdata push from that serial must present it via the
-- X-Device-Secret header or a device_secret query param, or be rejected.
-- Nullable so existing/unhardened devices keep working with no behavior
-- change until an admin opts in.
ALTER TABLE device_heartbeats ADD COLUMN IF NOT EXISTS device_secret TEXT;

-- ── 37/60 — migrations/20260828_tenant_backstop_rls.sql ───────────────────────────
-- Audit finding H-05: attendance, leaves, payroll, and reimbursements never
-- received a company_id column, despite being 4 of the 6 tables schema.sql
-- marks ENABLE ROW LEVEL SECURITY on. Tenant scoping for this data has been
-- 100% application code (resolve a company's employee-id list, then
-- .in('employee_id', ids)) with no DB-level structural backstop at all.
-- Run in Supabase SQL Editor.
--
-- IMPORTANT — read this before assuming the RLS policies below "close" the
-- gap on their own: this backend's Supabase client (config/supabase.js's
-- `supabaseAdmin`) authenticates with the SERVICE ROLE key, and Postgres/
-- PostgREST service_role BYPASSES RLS UNCONDITIONALLY — that is what the
-- key is for. 100% of this app's queries go through that client today.
-- These policies are therefore currently inert for the app itself, exactly
-- like the pre-existing RLS-enabled-zero-policies state on these same
-- tables was. They are still worth having: as documented intent, and as a
-- real backstop the moment ANYTHING queries these tables with a non-
-- service-role connection (a future anon-key path, a BI tool, a support
-- console, direct SQL access). See the note at the bottom of this file for
-- why "make the app's existing queries respect these policies" (the
-- instruction's Step 6) is not achievable as a code change on top of the
-- current service_role architecture.

-- ── Step 1: add the column (nullable first, so this never fails on
-- existing rows) ────────────────────────────────────────────────────────
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

-- ── Step 2: backfill from each row's own employee — same pattern already
-- used for documents.company_id in 20260826_documents_company_id.sql ──────
UPDATE attendance a SET company_id = e.company_id FROM employees e WHERE a.employee_id = e.id AND a.company_id IS NULL;
UPDATE leaves l SET company_id = e.company_id FROM employees e WHERE l.employee_id = e.id AND l.company_id IS NULL;
UPDATE payroll p SET company_id = e.company_id FROM employees e WHERE p.employee_id = e.id AND p.company_id IS NULL;
UPDATE reimbursements r SET company_id = e.company_id FROM employees e WHERE r.employee_id = e.id AND r.company_id IS NULL;

-- Any row whose employee no longer exists (employee deleted, row orphaned)
-- falls back to the platform's default tenant — the same fixed UUID
-- documents.company_id's backfill uses and backend/src/utils/tenant.js
-- (DEFAULT_COMPANY_ID) uses everywhere in application code.
UPDATE attendance SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE leaves SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE payroll SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
UPDATE reimbursements SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;

-- ── Step 3: enforce going forward, once every row is confirmed backfilled ──
ALTER TABLE attendance ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE leaves ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE payroll ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE reimbursements ALTER COLUMN company_id SET NOT NULL;

-- ── Step 5: composite indexes so filtering by (company_id, employee_id) —
-- the shape every tenant-scoped query on these tables now actually uses —
-- doesn't fall back to scanning the whole table on the new column. ────────
CREATE INDEX IF NOT EXISTS idx_attendance_company_employee ON attendance(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_company_employee ON leaves(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_company_employee ON payroll(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_reimbursements_company_employee ON reimbursements(company_id, employee_id);

-- ── Step 4: RLS policies for all six tables currently at zero policies ────
-- current_setting(..., true) returns NULL (not an error) when unset, and
-- `company_id = NULL` is never true — so a connection that never sets
-- app.company_id sees zero rows (fail closed), not every row.
DROP POLICY IF EXISTS tenant_isolation ON employees;
CREATE POLICY tenant_isolation ON employees
  USING (company_id = current_setting('app.company_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON attendance;
CREATE POLICY tenant_isolation ON attendance
  USING (company_id = current_setting('app.company_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON leaves;
CREATE POLICY tenant_isolation ON leaves
  USING (company_id = current_setting('app.company_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON payroll;
CREATE POLICY tenant_isolation ON payroll
  USING (company_id = current_setting('app.company_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON reimbursements;
CREATE POLICY tenant_isolation ON reimbursements
  USING (company_id = current_setting('app.company_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON documents;
CREATE POLICY tenant_isolation ON documents
  USING (company_id = current_setting('app.company_id', true)::uuid);

-- ── Why Step 6 ("make the backend's existing queries respect these
-- policies") is not a code change on top of this architecture ────────────
-- supabaseAdmin talks to Supabase over PostgREST using the service_role
-- JWT. service_role bypassing RLS is not a setting that can be toggled —
-- it's the defined behavior of that role in Postgres (BYPASSRLS), and it's
-- what lets this backend read/write across the whole database without an
-- RLS policy for every access pattern it needs. There is no per-request
-- "SET app.company_id" hook exposed by the supabase-js admin client (each
-- PostgREST call is a stateless HTTP request against a pooled connection,
-- not a persistent session), so nothing in application code can make a
-- service_role query start respecting these policies.
--
-- The two real paths to make RLS load-bearing (both are infrastructure/
-- architecture decisions, not something this migration or a controller
-- change can do): (a) route requests through Supabase's PostgREST using a
-- per-user JWT (supabaseAnon + real Supabase Auth sessions) instead of
-- supabaseAdmin, so `auth.uid()`/JWT claims are available for policies to
-- key on — a significant auth-architecture change; or (b) configure
-- PostgREST's db-pre-request hook (Supabase project setting) to read a
-- claim/header and SET LOCAL app.company_id before each query even for a
-- service-role-authenticated request — a Supabase project configuration
-- change, not an application code change.
--
-- Until one of those is in place, these policies are real, correct, and
-- worth having — but the actual tenant boundary remains 100% the
-- application-code checks already in place (getCompanyId, getTeamEmployeeIds,
-- the various .eq('company_id', ...) filters). Flagging this explicitly
-- rather than claiming it's closed.

-- ── 38/60 — migrations/20260829_api_keys_revoked_by.sql ───────────────────────────
-- Audit finding M-06: api_keys tracked created_by but not who revoked a key
-- — revoked_at alone leaves the audit trail incomplete. Set server-side
-- from the authenticated actor, never from the request body.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES employees(id) ON DELETE SET NULL;

-- ── 39/60 — migrations/20260829_attendance_audit_columns.sql ──────────────────────
-- Audit finding M-03: manualEntry() had no real audit trail for HR editing
-- another employee's attendance — the only trace of who made the edit was
-- an overridable `remarks` string. edited_by is set server-side from
-- req.user.id (never from the request body) on every manual create/correct.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS edited_by UUID REFERENCES employees(id) ON DELETE SET NULL;

-- ── 40/60 — migrations/20260829_attendance_composite_index.sql ────────────────────
-- Audit finding M-17: attendance has single-column indexes on employee_id
-- and check_in_time separately, but the dominant query shape (getAttendance,
-- getRangeSummary, getMonthlySummary, etc.) filters both together — a
-- composite index matches that shape directly instead of Postgres having to
-- intersect two single-column index scans.
CREATE INDEX IF NOT EXISTS idx_attendance_employee_checkin ON attendance(employee_id, check_in_time DESC);

-- ── 41/60 — migrations/20260829_career_events_bank_change_type.sql ────────────────
-- Fix for a bug introduced in this session's M-05 fix: employee.controller.js
-- now logs a 'bank_change' career event (CAREER_TRACKED_FIELDS), but the
-- original 20260826_employee_career_events.sql CHECK constraint on
-- event_type never included it — every bank_details edit would fail the
-- constraint. Widen the constraint. Dynamically finds the actual
-- auto-generated constraint name rather than assuming Postgres's default
-- naming, so this works regardless of what it was actually named.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_career_events') THEN
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'employee_career_events'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
    LOOP
      EXECUTE format('ALTER TABLE employee_career_events DROP CONSTRAINT %I', r.conname);
    END LOOP;

    ALTER TABLE employee_career_events ADD CONSTRAINT employee_career_events_event_type_check
      CHECK (event_type IN (
        'joined', 'designation_change', 'department_change', 'manager_change',
        'salary_change', 'bank_change', 'note'
      ));
  END IF;
END $$;

-- ── 42/60 — migrations/20260829_company_id_not_null.sql ───────────────────────────
-- Audit finding M-18: company_id exists but is nullable (no DB-level
-- backstop) across the tables 20260720_saas_phase2_tenant_columns.sql
-- touched, and is missing entirely from performance_goals/performance_reviews.
-- Idempotent and self-contained: safe to run whether or not
-- 20260720_saas_phase2_tenant_columns.sql has already run in this
-- environment (re-applies the same ADD COLUMN/backfill before SET NOT NULL).
-- Run in Supabase SQL Editor.

-- ── Part 1: tables that already have company_id (just enforce NOT NULL) ──
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'payroll_components', 'announcements', 'holidays', 'assets',
    'asset_categories', 'asset_requests', 'job_openings', 'candidates',
    'interviews', 'job_offers', 'review_cycles', 'courses',
    'helpdesk_tickets', 'kb_articles'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id)', tbl
      );
      EXECUTE format(
        'UPDATE %I SET company_id = %L WHERE company_id IS NULL', tbl,
        '00000000-0000-0000-0000-000000000001'
      );
      EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', tbl);
    END IF;
  END LOOP;
END $$;

-- ── Part 2: performance_goals / performance_reviews — company_id is net
-- new here (predates the multi-tenant migration entirely, scoped only via
-- an employee_id join today). Backend inserts now stamp it (see
-- performance.service.js's createGoal/openTeamReviews). ──────────────────
ALTER TABLE performance_goals ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE performance_goals g
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = g.employee_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;
ALTER TABLE performance_goals ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_performance_goals_company ON performance_goals(company_id);

ALTER TABLE performance_reviews ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE performance_reviews r
SET company_id = COALESCE(
  (SELECT e.company_id FROM employees e WHERE e.id = r.employee_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
WHERE company_id IS NULL;
ALTER TABLE performance_reviews ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_performance_reviews_company ON performance_reviews(company_id);

-- ── 43/60 — migrations/20260829_cron_locks.sql ────────────────────────────────────
-- Audit finding M-10: autoCheckout/autoPayroll cron jobs have no distributed
-- lock — harmless at one instance, but the moment this backend runs on more
-- than one instance, every instance's own node-cron schedule AND its own
-- setInterval catch-up fallback would fire independently, multi-running the
-- same job. A simple DB-backed advisory lock (acquire = INSERT, contested =
-- unique-violation, release = DELETE) closes that regardless of instance count.
CREATE TABLE IF NOT EXISTS cron_locks (
  job_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ NOT NULL
);

-- ── 44/60 — migrations/20260829_drop_employees_device_user_id.sql ─────────────────
-- Audit finding L-01: employees.device_user_id (globally UNIQUE) was a
-- competing, superseded design from the same day device_employee_mapping
-- (scoped UNIQUE(device_user_id, device_serial)) was introduced — the
-- mapping table is the one actually used everywhere in the app. Confirmed
-- via a full grep of backend/src that this column is never read or written
-- anywhere. Dropping it removes a landmine-shaped dead column (a global
-- unique constraint that would collide the moment two different physical
-- devices both number a user the same way) rather than leaving it to be
-- accidentally used by future code.
ALTER TABLE employees DROP COLUMN IF EXISTS device_user_id;

-- ── 45/60 — migrations/20260829_fix_mapping_lookup_index_order.sql ────────────────
-- Audit finding L-03: idx_mapping_lookup was (device_user_id, device_serial),
-- but the actual query shape (adms.service.js's mapPunchesToEmployees) is
-- .eq('device_serial', X).in('device_user_id', [...]) — serial is the
-- equality predicate, user_id the IN-list. A composite index should lead
-- with the equality column. Functionally correct either way (the old order
-- still worked), this just matches the index to the real query shape.
DROP INDEX IF EXISTS idx_mapping_lookup;
CREATE INDEX IF NOT EXISTS idx_mapping_lookup
  ON device_employee_mapping(device_serial, device_user_id);

-- ── 46/60 — migrations/20260829_kb_categories_backfill_safety.sql ─────────────────
-- Audit finding L-02: 20260827_kb_categories_per_company.sql set company_id
-- NOT NULL based only on a code comment ("table is empty in production"),
-- not a verified backfill statement. This is a defensive, idempotent
-- follow-up that's safe to run whether or not that migration already
-- succeeded: if it did, there's nothing to backfill and this is a no-op;
-- if kb_categories somehow still has NULL company_id rows (e.g. seeded
-- between the two migrations, or the assumption was wrong in some
-- environment), this backfills them before (re-)enforcing NOT NULL instead
-- of assuming.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kb_categories') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'kb_categories' AND column_name = 'company_id'
    ) THEN
      UPDATE kb_categories
      SET company_id = '00000000-0000-0000-0000-000000000001'
      WHERE company_id IS NULL;

      ALTER TABLE kb_categories ALTER COLUMN company_id SET NOT NULL;
    END IF;
  END IF;
END $$;

-- ── 47/60 — migrations/20260829_payroll_publish_audit.sql ─────────────────────────
-- Audit finding M-04: publishPayslip() had no persistent DB audit record of
-- who published a payslip, only an app log line (logger.info, not queryable
-- or tamper-resistant). published_by/published_at are set server-side from
-- the authenticated publisher, never from the request body.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- ── 48/60 — migrations/20260830_course_enrollments_unique.sql ─────────────────────
-- Audit finding N-07: createEnrollmentsBulk's existence-check-then-insert
-- had no DB-level backstop — course_enrollments had no unique constraint
-- on (course_id, employee_id), so two concurrent bulk-enroll calls with
-- overlapping employee sets could both pass the check and both insert,
-- producing silent duplicate enrollment rows. This constraint is the real
-- guard; the application-level existence check becomes a race-window
-- optimization on top of it, not the only protection.
ALTER TABLE course_enrollments
  ADD CONSTRAINT course_enrollments_unique_course_employee UNIQUE (course_id, employee_id);

-- ── 49/60 — migrations/20260830_drop_leave_balance_trigger.sql ────────────────────
-- Audit finding N-04 (second-pass audit): trg_leave_balance_update and
-- application code (leave.service.js's adjustLeaveBalanceUsed) both mutate
-- leave_balances.used on the exact same leaves.status transition — every
-- approval was double-deducting balance, every cancellation-from-approved
-- was double-restoring it. Keeping the app-code path (richer, testable,
-- already handles approve/reject/cancel) and dropping the trigger.
--
-- Does NOT touch trg_init_leave_balances / initialize_leave_balances() —
-- that's a different trigger (seeds a new employee's initial leave_balances
-- rows on INSERT) and is unaffected by this bug.
DROP TRIGGER IF EXISTS trg_leave_balance_update ON leaves;
DROP FUNCTION IF EXISTS update_leave_balance_on_approval();

-- ── 50/60 — migrations/20260830_employee_token_version.sql ────────────────────────
-- Audit finding N-12: no way to revoke a single still-valid access token
-- short of full account deactivation — logout/refresh-rotation only ever
-- removed the refresh_tokens row, leaving a stolen-but-not-yet-expired
-- access token (up to 24h TTL) fully usable regardless of logout or
-- password change. token_version is bumped on explicit logout, password
-- change, and deactivation; the JWT carries the version it was issued
-- with, and auth.middleware.js rejects a token whose version doesn't
-- match the current DB value.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- ── 51/60 — migrations/20260831_purge_stale_device_mappings.sql ───────────────────
-- Biometric cross-tenant isolation audit (device_employee_mapping lifecycle):
-- device_employee_mapping has no company_id column of its own — every read
-- resolves company via a live join to employees.company_id or scopes by
-- which company owns the device_serial. Before this session's app-code fix
-- (purge-on-employee-transfer in employee.controller.js's update(), purge-
-- on-release in adms.controller.js's new releaseDevice), neither of those
-- cleanup paths existed, so any mapping row whose employee had already
-- transferred to a different company than the one the device is registered
-- to is stale: it leaks that employee's name/employee_code to the device-
-- owning company's HR/Admin indefinitely (via deviceMapping.controller.js's
-- list/deviceUsers), and permanently occupies that device_user_id slot
-- (UNIQUE(device_user_id, device_serial)) so no one can remap it.
--
-- One-time backfill: delete any mapping row where the device it's scoped to
-- is claimed by a company (device_heartbeats.company_id IS NOT NULL — an
-- unclaimed device never processes punches at all, see assertDeviceAuthorized,
-- so a mapping on an unclaimed serial isn't a live isolation risk and is left
-- alone here) and the mapped employee's CURRENT company differs from it.
-- Idempotent: a second run finds nothing left to delete.
DELETE FROM device_employee_mapping dem
USING employees e, device_heartbeats dh
WHERE dem.employee_id = e.id
  AND dem.device_serial = dh.device_serial
  AND dh.company_id IS NOT NULL
  AND e.company_id IS NOT NULL
  AND e.company_id != dh.company_id;

-- ── 52/60 — migrations/20260901_subscription_billing.sql ──────────────────────────
-- ============================================================================
-- Subscription / Billing management (Super Admin panel)
-- 6 new tables: subscription_plans, company_billing_subscriptions,
-- subscription_invoices, subscription_payment_attempts, subscription_events,
-- subscription_notifications_log.
--
-- Fixed 2026-08-27: originally named `plans` and `company_subscriptions`.
-- Live-checked against the real database and found both names already taken
-- by pre-existing, unrelated tables (`plans`: 3 real rows, columns
-- price_monthly/max_employees/storage_gb/included_modules; `company_subscriptions`:
-- 0 rows, only 5 of the columns this feature needs). Neither is referenced
-- anywhere in this repo's tracked code, so they were created/seeded outside
-- it — dropping or repurposing them risked destroying data owned by
-- something outside this codebase's visibility. Renamed this feature's own
-- tables instead of touching them: plans -> subscription_plans,
-- company_subscriptions -> company_billing_subscriptions. Both names
-- confirmed free via a live existence check before this rename.
--
-- Money convention: DECIMAL(12,2), matching payroll.gross_salary/net_salary
-- and payroll_components.fixed_amount/amount elsewhere in this schema —
-- NOT integer smallest-unit (paise/cents) as originally proposed. Postgres
-- DECIMAL is exact (unlike IEEE float), so the "avoid float rounding" goal
-- is already met by the existing convention; introducing a second money
-- representation (integer paise) alongside DECIMAL(12,2) everywhere else
-- would be the actual inconsistency. Matching what's already there instead.
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  base_price_monthly DECIMAL(12,2) NOT NULL DEFAULT 0,
  base_price_quarterly DECIMAL(12,2) NOT NULL DEFAULT 0,
  base_price_annual DECIMAL(12,2) NOT NULL DEFAULT 0,
  price_per_seat_monthly DECIMAL(12,2) NOT NULL DEFAULT 0,
  price_per_seat_annual DECIMAL(12,2) NOT NULL DEFAULT 0,
  included_seats INTEGER NOT NULL DEFAULT 0,
  max_seats INTEGER,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  seat_count INTEGER NOT NULL DEFAULT 1,
  -- Snapshot of the actual price charged at signup/last renewal — plan price
  -- edits must never retroactively change what an existing subscription owes.
  price_locked_at_signup DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'trialing' CHECK (status IN (
    'trialing', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired'
  )),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT true,
  next_renewal_date TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  -- Grace-period bookkeeping: when a subscription first went past_due, so the
  -- daily cron can tell whether the configurable grace window has elapsed
  -- without re-deriving it from subscription_events every run.
  past_due_since TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_billing_subscriptions_company ON company_billing_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_company_billing_subscriptions_status ON company_billing_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_company_billing_subscriptions_next_renewal ON company_billing_subscriptions(next_renewal_date) WHERE status = 'active';
-- One active/trialing/past_due/grace_period subscription per company at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_billing_subscriptions_one_live_per_company
  ON company_billing_subscriptions(company_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'grace_period');

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_subscription_id UUID NOT NULL REFERENCES company_billing_subscriptions(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_number VARCHAR(40) UNIQUE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  seat_count_at_invoice INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending', 'paid', 'failed', 'refunded', 'void'
  )),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_method VARCHAR(30),
  payment_reference TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_subscription ON subscription_invoices(company_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_company ON subscription_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_status ON subscription_invoices(status);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_paid_at ON subscription_invoices(paid_at) WHERE paid_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_invoice_id UUID NOT NULL REFERENCES subscription_invoices(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
  failure_reason TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gateway_response JSONB
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON subscription_payment_attempts(subscription_invoice_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_subscription_id UUID NOT NULL REFERENCES company_billing_subscriptions(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
    'created', 'renewed', 'upgraded', 'downgraded', 'seat_added', 'seat_removed',
    'payment_failed', 'payment_recovered', 'suspended', 'reactivated', 'cancelled', 'expired'
  )),
  triggered_by VARCHAR(20) NOT NULL CHECK (triggered_by IN ('system', 'super_admin', 'company_admin')),
  triggered_by_user_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription ON subscription_events(company_subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_subscription_id UUID NOT NULL REFERENCES company_billing_subscriptions(id) ON DELETE CASCADE,
  -- 'renewed' added beyond the originally specified list: Phase 1 explicitly
  -- calls for a "renewed successfully" notification on auto-renewal, but no
  -- matching notification_type was included in the original enum — adding
  -- it here rather than misusing an unrelated type or skipping the dedup
  -- logging every other notification type gets.
  notification_type VARCHAR(30) NOT NULL CHECK (notification_type IN (
    'renewal_90d', 'renewal_30d', 'renewal_7d', 'renewal_1d',
    'payment_failed', 'grace_period_started', 'grace_period_ending',
    'suspended', 'welcome', 'plan_changed', 'renewed'
  )),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_to VARCHAR(255) NOT NULL,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_log_subscription ON subscription_notifications_log(company_subscription_id);
-- The dedup check every cron run makes: "did we already send type X for this
-- subscription today" — day-granularity via a plain date index is enough
-- since these crons run at most once/day.
CREATE INDEX IF NOT EXISTS idx_notifications_log_dedup ON subscription_notifications_log(company_subscription_id, notification_type, sent_at DESC);

-- ── Seed: 3 placeholder tiers. Business edits real pricing via the Plans UI. ──
INSERT INTO subscription_plans (name, code, description, base_price_monthly, base_price_quarterly, base_price_annual, price_per_seat_monthly, price_per_seat_annual, included_seats, max_seats, features, is_active)
VALUES
  ('Starter', 'starter', 'Core HR essentials for small teams.', 2999, 8399, 29999, 99, 999, 10, 25,
    '{"payroll": true, "biometric_adms": false, "advanced_reports": false, "api_access": false}'::jsonb, true),
  ('Growth', 'growth', 'Full HR + payroll + biometric attendance for growing companies.', 7999, 22399, 79999, 149, 1499, 25, 150,
    '{"payroll": true, "biometric_adms": true, "advanced_reports": true, "api_access": false}'::jsonb, true),
  ('Enterprise', 'enterprise', 'Unlimited scale, API access, and priority support.', 19999, 55999, 199999, 199, 1999, 50, NULL,
    '{"payroll": true, "biometric_adms": true, "advanced_reports": true, "api_access": true}'::jsonb, true)
ON CONFLICT (code) DO NOTHING;

-- ── 53/60 — migrations/20260902_employee_offboarding.sql ──────────────────────────
-- Resolves audit finding N-10: employee.controller.js's remove() did a real
-- hard delete cascading through attendance/leaves/payroll/documents/
-- enrollments. Product decision (2026-08-28): replace with a retained/
-- archived offboarding state; hard delete becomes a separate, explicitly
-- gated "permanently erase" action usable only on already-offboarded
-- employees.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status VARCHAR(20)
  NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active', 'on_leave', 'offboarded'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS offboarded_by UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_employment_status ON employees(employment_status);

-- Widen employee_career_events.event_type to log the offboard action itself
-- (the employee row survives offboarding, so this table's normal FK-cascade
-- behavior is fine here — unlike erasure, see below). Same dynamic
-- constraint-name lookup pattern as 20260829_career_events_bank_change_type.sql.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_career_events') THEN
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'employee_career_events'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
    LOOP
      EXECUTE format('ALTER TABLE employee_career_events DROP CONSTRAINT %I', r.conname);
    END LOOP;

    ALTER TABLE employee_career_events ADD CONSTRAINT employee_career_events_event_type_check
      CHECK (event_type IN (
        'joined', 'designation_change', 'department_change', 'manager_change',
        'salary_change', 'bank_change', 'note', 'offboarded'
      ));
  END IF;
END $$;

-- Standalone erasure audit record — deliberately NOT foreign-keyed to
-- employees(id): the whole point is to survive the employee row's deletion
-- as the compliance record of "this person's data was erased, by whom,
-- when, why." A snapshot of identifying fields is captured at erasure time
-- since the source row won't exist to join against afterward.
CREATE TABLE IF NOT EXISTS employee_erasure_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  employee_code TEXT,
  employee_name TEXT,
  employee_email TEXT,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  erased_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_employee_erasure_log_company ON employee_erasure_log(company_id);

-- ── 54/60 — migrations/20260903_install_prompt_seen.sql ───────────────────────────
-- Item 4: the floating "Install app" prompt currently shows on every page,
-- every session (sessionStorage-scoped dedup, resets on tab close). Track
-- "seen" server-side per employee so it doesn't reset on browser data clear
-- and reflects across devices — the flag this employee's /auth/me response
-- already returns via its existing `select('*')`, no other backend change
-- needed for the read side.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS has_seen_install_prompt BOOLEAN NOT NULL DEFAULT false;

-- ── 55/60 — migrations/20260904_profile_self_edit_lock.sql ────────────────────────
-- Item 3: employees may edit their own profile (contact info, address,
-- emergency contact, profile photo, and now bank details — item 2) only
-- ONCE. This flag is checked before allowing a self-edit submission and
-- set true right after the one allowed edit succeeds. HR/Admin can reset
-- it for a specific employee (genuine mistake, changed number, etc.) via
-- a dedicated action — see employee.controller.js's resetSelfEditLock.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS profile_self_edit_used BOOLEAN NOT NULL DEFAULT false;

-- ── 56/60 — migrations/20260905_onboarding_checklist_bank_details.sql ─────────────
-- Item 2: bank_details is now optional at employee creation, entered by the
-- employee themselves post-onboarding (see the one-time self-edit, item 3).
-- Adds a checklist item so HR has a visible reminder to follow up if it's
-- still missing by the time onboarding wraps up. Same seed-every-company
-- pattern as 20260826_onboarding_checklist.sql's original 5 items.
INSERT INTO onboarding_checklist_templates (company_id, label, sort_order)
SELECT c.id, 'Confirm employee has added bank details', 5
FROM companies c
ON CONFLICT (company_id, label) DO NOTHING;

-- ── 57/60 — migrations/20260906_course_enrollment_assigned_by.sql ─────────────────
-- Item 1: mandatory course assignment. assigned_by nullable, not a separate
-- is_mandatory boolean — it already tells us mandatory-or-not (NULL =
-- self-enrolled, set = HR/Admin-assigned = mandatory) AND who assigned it,
-- which the "Assigned by [name]" UI requirement needs anyway. A separate
-- boolean would be a redundant column carrying the same information.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_assigned_by ON course_enrollments(assigned_by) WHERE assigned_by IS NOT NULL;

-- ── 58/60 — migrations/20260907_attendance_anomaly_alerts.sql ─────────────────────
-- Item 4: attendance anomaly email alerts. Mirrors
-- subscription_notifications_log's pattern (dedup + audit trail), scoped
-- to attendance instead.
CREATE TABLE IF NOT EXISTS attendance_anomaly_alerts_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  alert_date DATE NOT NULL,
  anomaly_type VARCHAR(20) NOT NULL CHECK (anomaly_type IN ('absent', 'late', 'short_hours')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_to VARCHAR(255),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One alert per employee per day — if the cron's catch-up interval fires
  -- twice in a day, this constraint (not just an app-level dedup check)
  -- is the real guard against a duplicate email.
  UNIQUE (employee_id, alert_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_anomaly_alerts_company_date ON attendance_anomaly_alerts_log(company_id, alert_date DESC);

-- ── 59/60 — migrations/20260908_audit_logs.sql ────────────────────────────────────
-- Item 5: single queryable audit trail across the whole system. No central
-- write chokepoint exists in this codebase (supabaseAdmin is a thin,
-- uninstrumented proxy straight onto the raw supabase-js client — every
-- controller/service calls .from().insert/update/delete() directly, with
-- nothing generic in between) — confirmed by reading config/supabase.js.
-- So this is populated by explicit logAudit() calls at identified sensitive
-- action points (see auditLog.service.js), not a generic hook.
--
-- Fixed 2026-08-28: originally named `audit_logs`, which collides with a
-- pre-existing, unrelated live table of the same name — 0 rows, but a
-- completely different 6-column schema (id, actor_id, ip_address,
-- created_at, action, details — no company_id at all, so not even
-- company-scoped). Nothing in this repo's tracked code reads/writes it
-- except this session's own new auditLog.service.js, so it was created
-- outside this codebase. Same situation as the plans/company_subscriptions
-- collision fixed earlier — didn't touch/drop it (unknown external
-- dependents), renamed this feature's own table instead: audit_logs ->
-- employee_audit_logs. Confirmed free via a live existence check.
CREATE TABLE IF NOT EXISTS employee_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  actor_role VARCHAR(20) NOT NULL,
  action_type VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id UUID,
  before_state JSONB,
  after_state JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_audit_logs_company_created ON employee_audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_audit_logs_actor ON employee_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_employee_audit_logs_action_type ON employee_audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_employee_audit_logs_target ON employee_audit_logs(target_type, target_id);

-- ── 60/60 — migrations/20260909_backup_logs.sql ───────────────────────────────────
-- Item 6: "Automatic Backups" in Settings > Data & Backup was a stored
-- preference with nothing consuming it — no job ever ran, "Run Backup Now"
-- was disabled in the UI with an explicit "Not yet implemented" label.
-- This table backs the real implementation: every completed (or failed)
-- backup run, on-demand or scheduled, so "Last backup" reflects reality
-- instead of a static display value.
CREATE TABLE IF NOT EXISTS backup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed')),
  format VARCHAR(10) NOT NULL DEFAULT 'json',
  storage_path TEXT,
  triggered_by VARCHAR(20) NOT NULL CHECK (triggered_by IN ('manual', 'scheduled')),
  triggered_by_user_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_company_started ON backup_logs(company_id, started_at DESC);


-- ── 61/62 — migrations/20260910_temp_password_expiry.sql ──────────────────
-- Email redesign task: bulk_import/dayone templates promise "this temporary
-- password expires in 48 hours" — this column + the login-time check in
-- auth.service.js (authenticateEmployee) makes that real, not just copy.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;

-- ── 62/62 — migrations/20260911_super_admin_console.sql ───────────────────
-- Super Admin operations console — Modules 1-7 (dashboard, company detail,
-- billing extensions, impersonation/support, multi-user + 2FA super-admin
-- auth, feature/seat overrides, real cron history). See that migration file
-- for the full rationale on each table.

ALTER TABLE super_admins
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'full_admin'
    CHECK (role IN ('full_admin', 'billing_admin', 'support_admin')),
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS industry VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_size VARCHAR(20);

CREATE TABLE IF NOT EXISTS company_internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_internal_notes_company ON company_internal_notes(company_id, created_at DESC);

ALTER TABLE employee_audit_logs
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'employee'
    CHECK (actor_type IN ('employee', 'super_admin', 'system')),
  ADD COLUMN IF NOT EXISTS super_admin_actor_id UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_impersonated BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_employee_audit_logs_super_admin_actor ON employee_audit_logs(super_admin_actor_id) WHERE super_admin_actor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  ip_address VARCHAR(64),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_active ON impersonation_sessions(target_employee_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_company ON impersonation_sessions(company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS cron_run_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_run_log_job_finished ON cron_run_log(job_name, finished_at DESC);

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value DECIMAL(12,2) NOT NULL CHECK (discount_value > 0),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  max_redemptions INTEGER,
  times_redeemed INTEGER NOT NULL DEFAULT 0,
  applicable_plan_ids JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_to_invoice_id UUID REFERENCES subscription_invoices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_company ON company_coupon_redemptions(company_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON company_coupon_redemptions(coupon_id);

CREATE TABLE IF NOT EXISTS company_feature_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  reason TEXT,
  set_by UUID REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_company_feature_overrides_company ON company_feature_overrides(company_id);

ALTER TABLE company_billing_subscriptions
  ADD COLUMN IF NOT EXISTS max_seats_override INTEGER;

ALTER TABLE employee_audit_logs ALTER COLUMN company_id DROP NOT NULL;

-- ── 63/63 — migrations/20260912_super_admin_console_fixes.sql ─────────────
-- Follow-up session: manual invoice / extend subscription / feature
-- registry / export gating. See that migration file for full rationale.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'subscription_events'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE subscription_events DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE subscription_events ADD CONSTRAINT subscription_events_event_type_check
    CHECK (event_type IN (
      'created', 'renewed', 'upgraded', 'downgraded', 'seat_added', 'seat_removed',
      'payment_failed', 'payment_recovered', 'suspended', 'reactivated', 'cancelled', 'expired',
      'manual_extension'
    ));
END $$;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS export_override_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── 64/64 — migrations/20260913_beacons_geofence_billing_gating.sql ───────
-- IP beacon system, GPS geofencing, tenant billing self-service, and
-- strict feature-disable data handling. See that migration file for the
-- full rationale on each table.

CREATE TABLE IF NOT EXISTS ip_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cidr TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ip_whitelist_company ON ip_whitelist(company_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS ip_beacons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  beacon_key TEXT UNIQUE NOT NULL,
  beacon_secret_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_whitelist_entry_id UUID REFERENCES ip_whitelist(id) ON DELETE SET NULL,
  expected_region TEXT,
  last_pushed_ip TEXT,
  last_pushed_at TIMESTAMPTZ,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES employees(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_beacons_company ON ip_beacons(company_id);

CREATE TABLE IF NOT EXISTS ip_beacon_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES ip_beacons(id) ON DELETE CASCADE,
  observed_ip TEXT NOT NULL,
  ip_changed BOOLEAN NOT NULL DEFAULT false,
  pinged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ip_beacon_pings_beacon_time ON ip_beacon_pings(beacon_id, pinged_at DESC);

CREATE TABLE IF NOT EXISTS ip_beacon_pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES ip_beacons(id) ON DELETE CASCADE,
  proposed_ip TEXT NOT NULL,
  detected_region TEXT,
  reason TEXT NOT NULL DEFAULT 'geo_mismatch' CHECK (reason IN ('geo_mismatch')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES employees(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_beacon_pending_approvals_beacon ON ip_beacon_pending_approvals(beacon_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  center_latitude DOUBLE PRECISION NOT NULL CHECK (center_latitude BETWEEN -90 AND 90),
  center_longitude DOUBLE PRECISION NOT NULL CHECK (center_longitude BETWEEN -180 AND 180),
  radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (radius_meters BETWEEN 20 AND 2000),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geofences_company ON geofences(company_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  requested_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feature_requests_company ON feature_requests(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_subscription_id UUID REFERENCES company_billing_subscriptions(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('plan', 'seats', 'billing_cycle', 'cancel')),
  requested_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'completed', 'cancelled')),
  requested_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES super_admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_change_requests_company ON subscription_change_requests(company_id, created_at DESC);

ALTER TABLE company_feature_overrides
  ADD COLUMN IF NOT EXISTS data_collection_mode TEXT NOT NULL DEFAULT 'continue'
    CHECK (data_collection_mode IN ('continue', 'stop'));

CREATE TABLE IF NOT EXISTS adms_discarded_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_serial TEXT NOT NULL,
  raw_punch_data JSONB NOT NULL,
  discarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adms_discarded_punches_purge ON adms_discarded_punches(discarded_at);

-- ── 65/65 — migrations/20260914_manual_payment_recording.sql ──────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'subscription_invoices'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE subscription_invoices DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_status_check
    CHECK (status IN (
      'draft', 'pending', 'paid', 'partially_paid', 'failed', 'refunded', 'void'
    ));
END $$;

ALTER TABLE subscription_invoices
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN subscription_invoices.amount_paid IS
  'Running total actually recorded as received via record-payment. May be less than amount (status=partially_paid) or equal to it (status=paid).';

-- ── 66/66 — migrations/20260915_schema_migrations_tracking.sql ────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);

INSERT INTO schema_migrations (filename, applied_at, verified) VALUES
  ('20260720_saas_phase1_companies_employees.sql', '2026-07-20T00:00:00Z', false),
  ('20260720_saas_phase2_tenant_columns.sql', '2026-07-20T00:00:00Z', false),
  ('20260720_course_enrollment_archive.sql', '2026-07-20T00:00:00Z', false),
  ('20260721_employee_code_per_company.sql', '2026-07-21T00:00:00Z', false),
  ('20260723_api_keys.sql', '2026-07-23T00:00:00Z', false),
  ('20260723_company_hierarchy.sql', '2026-07-23T00:00:00Z', false),
  ('20260723_employee_code_emp001.sql', '2026-07-23T00:00:00Z', false),
  ('20260817_super_admin_onboarding_invites.sql', '2026-08-17T00:00:00Z', false),
  ('20260820_must_change_password.sql', '2026-08-20T00:00:00Z', false),
  ('20260821_adms_device_punches.sql', '2026-08-21T00:00:00Z', false),
  ('20260821_device_employee_mapping.sql', '2026-08-21T00:00:00Z', false),
  ('20260821_device_heartbeats_company.sql', '2026-08-21T00:00:00Z', false),
  ('20260821_device_heartbeats_registry.sql', '2026-08-21T00:00:00Z', false),
  ('20260825_device_punches_scope_dedup_by_device.sql', '2026-08-25T00:00:00Z', false),
  ('20260826_course_enrollment_deadline.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_documents_company_id.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_employee_career_events.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_employee_email_per_company.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_onboarding_checklist.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_onboarding_invite_slug.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_recruitment_richer_fields.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_reimbursement_accommodation_type.sql', '2026-08-26T00:00:00Z', false),
  ('20260826_super_admin_refresh_tokens.sql', '2026-08-26T00:00:00Z', false),
  ('20260827_kb_categories_per_company.sql', '2026-08-27T00:00:00Z', false),
  ('20260828_adms_device_secret.sql', '2026-08-28T00:00:00Z', false),
  ('20260828_tenant_backstop_rls.sql', '2026-08-28T00:00:00Z', false),
  ('20260829_api_keys_revoked_by.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_attendance_audit_columns.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_attendance_composite_index.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_career_events_bank_change_type.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_company_id_not_null.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_cron_locks.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_drop_employees_device_user_id.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_fix_mapping_lookup_index_order.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_kb_categories_backfill_safety.sql', '2026-08-29T00:00:00Z', false),
  ('20260829_payroll_publish_audit.sql', '2026-08-29T00:00:00Z', false),
  ('20260830_course_enrollments_unique.sql', '2026-08-30T00:00:00Z', false),
  ('20260830_drop_leave_balance_trigger.sql', '2026-08-30T00:00:00Z', false),
  ('20260830_employee_token_version.sql', '2026-08-30T00:00:00Z', false),
  ('20260831_purge_stale_device_mappings.sql', '2026-08-31T00:00:00Z', false),
  ('20260901_subscription_billing.sql', '2026-09-01T00:00:00Z', false),
  ('20260902_employee_offboarding.sql', '2026-09-02T00:00:00Z', false),
  ('20260903_install_prompt_seen.sql', '2026-09-03T00:00:00Z', false),
  ('20260904_profile_self_edit_lock.sql', '2026-09-04T00:00:00Z', false),
  ('20260905_onboarding_checklist_bank_details.sql', '2026-09-05T00:00:00Z', false),
  ('20260906_course_enrollment_assigned_by.sql', '2026-09-06T00:00:00Z', false),
  ('20260907_attendance_anomaly_alerts.sql', '2026-09-07T00:00:00Z', false),
  ('20260908_audit_logs.sql', '2026-09-08T00:00:00Z', false),
  ('20260909_backup_logs.sql', '2026-09-09T00:00:00Z', false),
  ('20260910_temp_password_expiry.sql', '2026-09-10T00:00:00Z', false),
  ('20260911_super_admin_console.sql', '2026-09-11T00:00:00Z', false),
  ('20260912_super_admin_console_fixes.sql', '2026-09-12T00:00:00Z', false),
  ('20260913_beacons_geofence_billing_gating.sql', '2026-09-13T00:00:00Z', false),
  ('20260914_manual_payment_recording.sql', '2026-09-14T00:00:00Z', false),
  ('add_attendance_mode.sql', NOW(), false),
  ('add_attendance_status_wfh.sql', NOW(), false),
  ('create_lms_tables.sql', NOW(), false),
  ('create_wfh_day_requests.sql', NOW(), false)
ON CONFLICT (filename) DO NOTHING;

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20260915_schema_migrations_tracking.sql', true)
  ON CONFLICT (filename) DO NOTHING;

-- ── 67/67 — migrations/20260916_webhooks.sql ───────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  subscribed_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_company ON webhooks(company_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  delivered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20260916_webhooks.sql', true)
  ON CONFLICT (filename) DO NOTHING;
