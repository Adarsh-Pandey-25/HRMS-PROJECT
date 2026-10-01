-- 20261002_one_biometric_id_per_employee.sql
-- One biometric ID per employee.
--
-- device_employee_mapping was only unique on (device_user_id, device_serial):
-- an ID could not be given to two people on one device, but one person could
-- be given two IDs. The API now refuses that; this makes the database refuse
-- it too, so no code path (or two requests at once) can slip one through.
--
-- The same ID on several of the company's devices is still allowed — that is
-- one person enrolled on more than one machine, with one ID.
--
-- If any employee ALREADY has two different IDs, this stops and lists them,
-- and nothing is changed. Remove the wrong mapping for each one (Settings →
-- Attendance → Device → Employee Mapping), then run this again.
-- Safe to run more than once.

BEGIN;

DO $$
DECLARE
  problem text;
BEGIN
  SELECT string_agg(format('%s %s (%s): IDs %s', e.first_name, e.last_name, e.employee_code, d.ids), '; ')
    INTO problem
    FROM (SELECT employee_id, string_agg(DISTINCT device_user_id, ', ') AS ids
            FROM device_employee_mapping
           GROUP BY employee_id
          HAVING count(DISTINCT device_user_id) > 1) d
    JOIN employees e ON e.id = d.employee_id;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing changed — these employees already have more than one biometric ID. Remove the wrong mapping for each, then run this again: %', problem;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_one_biometric_id_per_employee()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  other_id text;
BEGIN
  -- Serialise mapping writes for one employee, so two requests at the same
  -- moment cannot both pass the check below. Each statement in this
  -- function takes a fresh snapshot, so the check sees a row the other
  -- request committed while this one waited for the lock.
  PERFORM pg_advisory_xact_lock(hashtext('device_employee_mapping:' || NEW.employee_id::text));

  SELECT device_user_id INTO other_id
    FROM device_employee_mapping
   WHERE employee_id = NEW.employee_id
     AND device_user_id <> NEW.device_user_id
     AND id <> NEW.id
   LIMIT 1;

  IF other_id IS NOT NULL THEN
    RAISE EXCEPTION 'Employee % already has biometric ID %', NEW.employee_id, other_id
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'one_biometric_id_per_employee';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_one_biometric_id_per_employee ON device_employee_mapping;
CREATE TRIGGER trg_one_biometric_id_per_employee
  BEFORE INSERT OR UPDATE OF employee_id, device_user_id ON device_employee_mapping
  FOR EACH ROW EXECUTE FUNCTION enforce_one_biometric_id_per_employee();

COMMIT;
