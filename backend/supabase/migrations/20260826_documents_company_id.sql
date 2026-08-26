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
