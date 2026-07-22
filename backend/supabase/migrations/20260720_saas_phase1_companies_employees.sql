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
