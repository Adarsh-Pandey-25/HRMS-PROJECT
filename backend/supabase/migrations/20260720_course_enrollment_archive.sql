-- HR can archive completed enrollments to declutter the tracking dashboard.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_archived ON course_enrollments(is_archived);
