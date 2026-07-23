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
