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
