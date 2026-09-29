-- 20260929_course_chapters_and_category.sql
-- Makes course chapters real, and adds the course category the catalog card
-- has always rendered.
--
-- course_chapters has existed since training_v2, but nothing ever wrote to it:
-- course.service.js's addChapter returned a hardcoded {id:'default'} object
-- without touching the database, so POST /training/courses/:id/chapters
-- silently did nothing. The table was never given the column that links a
-- lesson to a chapter, which is what this adds.

-- Grouping only. lesson_order stays the single global watch sequence for a
-- course — the sequential-unlock checks in getCourseForEmployee and
-- assertPriorLessonsComplete both read it, so moving a lesson between chapters
-- must never renumber it. ON DELETE SET NULL so deleting a chapter returns its
-- lessons to the ungrouped section instead of destroying them (and their
-- progress rows with them).
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES course_chapters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_lessons_chapter
  ON course_lessons(chapter_id) WHERE chapter_id IS NOT NULL;

-- CourseCatalog.jsx has always rendered `humanize(c.category || 'general')`
-- as a badge on every card, but no such column existed, so every course
-- showed "General". Free text rather than an enum: the filter chips are built
-- from the distinct values actually in use, so adding a category is something
-- HR does by typing one, not by shipping a migration.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_courses_category
  ON courses(company_id, category) WHERE category IS NOT NULL;
