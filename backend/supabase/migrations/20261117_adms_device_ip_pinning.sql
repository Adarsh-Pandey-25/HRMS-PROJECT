-- 20261117_adms_device_ip_pinning.sql
-- Biometric devices (eSSL push / ADMS, /iclock/cdata) are pinned to the
-- public IP they report from. The protocol carries no login, and the
-- device's serial is printed on the unit, so the serial alone must not be
-- enough to post punches (security audit, finding #1).
--
--   allowed_ip          the IP punches are accepted from. Empty = learn it:
--                       the next request from the registered device pins it.
--   pending_ip          the last different IP the device (or someone using
--                       its serial) reported from; punches from it are
--                       refused until an Admin chooses "Allow new IP".
--   pending_ip_seen_at  when that pending IP was first seen.
--   ip_pinned_at        when allowed_ip was set.
--
-- Additive only; no existing row changes. Every registered device starts
-- empty and pins on its next heartbeat (every ~30 seconds).
-- Run this BEFORE deploying the code that reads these columns: until it
-- runs, device pushes are refused (devices keep the punches and resend them).
-- Safe to run more than once.

ALTER TABLE device_heartbeats ADD COLUMN IF NOT EXISTS allowed_ip TEXT;
ALTER TABLE device_heartbeats ADD COLUMN IF NOT EXISTS pending_ip TEXT;
ALTER TABLE device_heartbeats ADD COLUMN IF NOT EXISTS pending_ip_seen_at TIMESTAMPTZ;
ALTER TABLE device_heartbeats ADD COLUMN IF NOT EXISTS ip_pinned_at TIMESTAMPTZ;
