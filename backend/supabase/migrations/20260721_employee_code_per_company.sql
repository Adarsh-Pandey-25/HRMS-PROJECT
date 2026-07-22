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
