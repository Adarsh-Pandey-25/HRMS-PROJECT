-- Let HR/Admin label a device (friendly name + location) from the frontend,
-- on top of the last_seen_at heartbeat data already recorded by /iclock/*.
ALTER TABLE device_heartbeats
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT;
