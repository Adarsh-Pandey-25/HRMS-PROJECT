-- LMS (Coursera/Udemy-style) — flat Course → Lessons model
-- FK table is `employees` (this project does not use a `users` table).
-- Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS / additive alters).
-- No Prisma — raw PostgreSQL only.

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  thumbnail_key TEXT,
  target_departments TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE courses ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS target_departments TEXT[] DEFAULT '{}';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id) ON DELETE SET NULL;

UPDATE courses
SET status = CASE WHEN COALESCE(is_active, true) THEN 'ACTIVE' ELSE 'ARCHIVED' END
WHERE status IS NULL OR status NOT IN ('ACTIVE', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- course_lessons (flat; no chapters)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lesson_order INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('VIDEO_UPLOAD', 'EXTERNAL_LINK')),
  video_url TEXT,
  video_key TEXT,
  external_link TEXT,
  video_duration FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_course ON course_lessons(course_id);

-- ---------------------------------------------------------------------------
-- course_enrollments
-- user_id = employee id (REFERENCES employees). employee_id kept for legacy rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE course_enrollments ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE CASCADE;

UPDATE course_enrollments SET user_id = employee_id WHERE user_id IS NULL AND employee_id IS NOT NULL;
UPDATE course_enrollments SET employee_id = user_id WHERE employee_id IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_employee ON course_enrollments(employee_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);

-- ---------------------------------------------------------------------------
-- course_progress (anti-skip tracker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  watched_seconds FLOAT DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  UNIQUE (enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_course_progress_enrollment ON course_progress(enrollment_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_courses_updated ON courses;
    CREATE TRIGGER trg_courses_updated
      BEFORE UPDATE ON courses
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
