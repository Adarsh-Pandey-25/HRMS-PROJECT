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
