-- The "Assign Course" modal already captures a deadline date; it had nowhere
-- to be stored. Run in Supabase SQL Editor.
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS deadline DATE;
