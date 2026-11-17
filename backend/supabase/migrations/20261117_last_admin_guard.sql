-- 20261117_last_admin_guard.sql
-- A company always keeps at least one active Admin.
--
-- employee.controller.js already refuses to demote, deactivate, offboard,
-- erase or move a company's last active Admin. But two Admins demoting each
-- other at the same moment could both pass that check, each still seeing the
-- other as an Admin, and leave the company with none. This trigger is the
-- backstop: changes to a company's Admins go one at a time, and the last
-- active Admin can't stop being one.
--
-- Deleting a whole company (its employees go with it) is not blocked.
-- Additive and safe to run more than once.

CREATE OR REPLACE FUNCTION keep_last_company_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  others integer;
BEGIN
  -- Only an active Admin of a company losing that status matters.
  IF OLD.role IS DISTINCT FROM 'admin' OR OLD.is_active IS NOT TRUE OR OLD.company_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.role = 'admin' AND NEW.is_active IS TRUE
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;
  -- The company itself is being deleted: nothing to keep.
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- One change at a time per company, so the count below sees any other
  -- Admin change that has just been committed.
  PERFORM pg_advisory_xact_lock(hashtextextended('last_admin:' || OLD.company_id::text, 0));
  SELECT count(*) INTO others
    FROM employees
   WHERE company_id = OLD.company_id
     AND role = 'admin'
     AND is_active IS TRUE
     AND id <> OLD.id;
  IF others = 0 THEN
    RAISE EXCEPTION 'This is the company''s last active Admin. Make someone else an Admin first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_keep_last_company_admin ON employees;
CREATE TRIGGER trg_keep_last_company_admin
  BEFORE UPDATE OF role, is_active, company_id OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION keep_last_company_admin();

INSERT INTO schema_migrations (filename, verified)
  VALUES ('20261117_last_admin_guard.sql', true)
  ON CONFLICT (filename) DO NOTHING;
