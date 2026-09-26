-- Selfie check-in: storage path (private `documents` bucket, under
-- attendance-selfies/<company>/<employee>/<date>/) of the photo taken at
-- web/app check-in. Required when attendance_config.selfieRequired is on;
-- the backend hands out short-lived signed URLs to view it.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_selfie TEXT;
