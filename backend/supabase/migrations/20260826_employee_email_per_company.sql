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
