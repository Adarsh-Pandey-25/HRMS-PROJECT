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
