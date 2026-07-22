/**
 * LMS course service — flat Course → course_lessons (no Prisma).
 * Uses supabaseAdmin + course_lessons / course_progress / course_enrollments.
 */
const { supabaseAdmin } = require('../config/supabase');
const {
  uploadCourseVideo,
  uploadCourseThumbnail,
  getSignedUrl,
  resolveCourseVideoBucket,
  STORAGE_BUCKETS,
} = require('./storage.service');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { DEFAULT_COMPANY_ID, getCompanyId } = require('../utils/tenant');
const logger = require('../utils/logger');

const COMPLETION_GRACE_SECONDS = 5;
const PROGRESS_JUMP_TOLERANCE = 12;

const resolveCompanyId = (companyId) => companyId || DEFAULT_COMPANY_ID;

const normalizeDept = (dept) => (dept || '').trim().toLowerCase();

const departmentMatches = (employeeDept, targetDepartments = []) => {
  const targets = targetDepartments || [];
  if (!targets.length || targets.some((d) => normalizeDept(d) === 'all')) return true;
  const emp = normalizeDept(employeeDept);
  if (!emp) return false;
  return targets.some((d) => normalizeDept(d) === emp);
};

const enrollmentUserFilter = (employeeId) => (
  // Dual-column: prefer matching either user_id or employee_id
  `user_id.eq.${employeeId},employee_id.eq.${employeeId}`
);

const listDepartments = async () => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('department')
    .not('department', 'is', null)
    .eq('is_active', true);

  if (error) throw new BadRequestError(error.message);

  const seen = new Map();
  for (const row of data || []) {
    const dept = row.department?.trim();
    if (!dept) continue;
    const key = normalizeDept(dept);
    if (!seen.has(key)) seen.set(key, dept);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

const attachSignedUrls = async (course) => {
  const result = { ...course };
  if (course.thumbnail_key) {
    result.thumbnail_url = await getSignedUrl(STORAGE_BUCKETS.trainingMaterials, course.thumbnail_key, 7200);
  }
  result.status = course.status || (course.is_active === false ? 'ARCHIVED' : 'ACTIVE');
  return result;
};

const resolveLessonPlaybackUrl = async (lesson) => {
  if (lesson.type === 'EXTERNAL_LINK') {
    return { ...lesson, playback_url: lesson.external_link || null };
  }
  const key = lesson.video_key || lesson.video_url;
  if (!key) return { ...lesson, playback_url: null };
  // Absolute URL already stored
  if (/^https?:\/\//i.test(key)) {
    return { ...lesson, video_url: key, playback_url: key };
  }
  const bucket = resolveCourseVideoBucket(key);
  const signed = await getSignedUrl(bucket, key, 7200);
  return { ...lesson, video_url: signed, playback_url: signed };
};

const listLessonsForCourse = async (courseId, { withUrls = false } = {}) => {
  const { data, error } = await supabaseAdmin
    .from('course_lessons')
    .select('*')
    .eq('course_id', courseId)
    .order('lesson_order', { ascending: true });

  if (error) throw new BadRequestError(error.message);
  const lessons = data || [];
  if (!withUrls) return lessons;
  return Promise.all(lessons.map(resolveLessonPlaybackUrl));
};

const getLessonCountsByCourse = async () => {
  const { data, error } = await supabaseAdmin
    .from('course_lessons')
    .select('id, course_id');

  if (error) throw new BadRequestError(error.message);
  const counts = {};
  for (const row of data || []) {
    counts[row.course_id] = (counts[row.course_id] || 0) + 1;
  }
  return counts;
};

const progressStatsForEnrollment = async (enrollmentId, courseId) => {
  const [{ data: lessons }, { data: progress }] = await Promise.all([
    supabaseAdmin.from('course_lessons').select('id').eq('course_id', courseId),
    supabaseAdmin
      .from('course_progress')
      .select('lesson_id, is_completed')
      .eq('enrollment_id', enrollmentId),
  ]);

  const totalLessons = (lessons || []).length;
  const completedLessons = (progress || []).filter((p) => p.is_completed).length;
  return { total_lessons: totalLessons, completed_lessons: completedLessons, totalLessons, completedLessons };
};

const createCourse = async (payload, userId, thumbnailFile, companyId) => {
  let thumbnailKey = null;
  if (thumbnailFile) {
    const { path } = await uploadCourseThumbnail(thumbnailFile);
    thumbnailKey = path;
  }

  const status = String(payload.status || 'ACTIVE').toUpperCase() === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  const cid = resolveCompanyId(companyId);

  const { data, error } = await supabaseAdmin
    .from('courses')
    .insert({
      title: payload.title,
      description: payload.description || '',
      target_departments: payload.targetDepartments || payload.target_departments || [],
      thumbnail_key: thumbnailKey,
      created_by: userId,
      status,
      is_active: status === 'ACTIVE',
      company_id: cid,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return attachSignedUrls(data);
};

const updateCourse = async (courseId, payload, thumbnailFile) => {
  const updates = {};
  if (payload.title !== undefined) updates.title = payload.title;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.targetDepartments !== undefined || payload.target_departments !== undefined) {
    updates.target_departments = payload.targetDepartments || payload.target_departments;
  }
  if (payload.status !== undefined) {
    const status = String(payload.status).toUpperCase() === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
    updates.status = status;
    updates.is_active = status === 'ACTIVE';
  }
  if (payload.isActive !== undefined || payload.is_active !== undefined) {
    const active = payload.isActive !== undefined ? payload.isActive : payload.is_active;
    updates.is_active = Boolean(active);
    updates.status = active ? 'ACTIVE' : 'ARCHIVED';
  }

  if (thumbnailFile) {
    const { path } = await uploadCourseThumbnail(thumbnailFile);
    updates.thumbnail_key = path;
  }

  const { data, error } = await supabaseAdmin
    .from('courses')
    .update(updates)
    .eq('id', courseId)
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Course not found');
  return attachSignedUrls(data);
};

const listManageCourses = async (companyId) => {
  const cid = resolveCompanyId(companyId);
  const { data, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('company_id', cid)
    .order('created_at', { ascending: false });

  if (error) throw new BadRequestError(error.message);

  const lessonCounts = await getLessonCountsByCourse();
  return Promise.all((data || []).map(async (course) => {
    const withThumb = await attachSignedUrls(course);
    return {
      ...withThumb,
      lesson_count: lessonCounts[course.id] || 0,
      totalLessons: lessonCounts[course.id] || 0,
    };
  }));
};

const listCatalog = async (employee, companyId) => {
  const cid = resolveCompanyId(companyId || getCompanyId(employee));
  const [{ data: courses, error }, { data: enrollments }, lessonCounts] = await Promise.all([
    supabaseAdmin
      .from('courses')
      .select('id, title, description, thumbnail_key, target_departments, status, is_active, created_at, company_id')
      .eq('company_id', cid)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('course_enrollments')
      .select('id, course_id, status, enrolled_at, completed_at, user_id, employee_id, course_progress(lesson_id, is_completed, watched_seconds)')
      .or(enrollmentUserFilter(employee.id)),
    getLessonCountsByCourse(),
  ]);

  if (error) throw new BadRequestError(error.message);

  const enrollmentMap = new Map((enrollments || []).map((e) => [e.course_id, e]));
  const matched = (courses || []).filter((c) => {
    const active = c.status === 'ACTIVE' || c.is_active !== false;
    if (!active) return false;
    if (enrollmentMap.has(c.id)) return true;
    return departmentMatches(employee.department, c.target_departments);
  });

  return Promise.all(matched.map(async (course) => {
    const withThumb = await attachSignedUrls(course);
    const enrollment = enrollmentMap.get(course.id);
    const totalLessons = lessonCounts[course.id] || 0;
    const completedLessons = (enrollment?.course_progress || []).filter((p) => p.is_completed).length;
    const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

    return {
      ...withThumb,
      enrollment: enrollment
        ? {
          id: enrollment.id,
          status: enrollment.status,
          enrolledAt: enrollment.enrolled_at,
          completedAt: enrollment.completed_at,
          progressPercent,
          completed_lessons: completedLessons,
          total_lessons: totalLessons,
        }
        : null,
      completed_lessons: completedLessons,
      total_lessons: totalLessons,
      totalLessons,
      progressPercent,
    };
  }));
};

/** Alias used by existing controller */
const listEmployeeCourses = listCatalog;

const getCourseForEmployee = async (courseId, employee) => {
  const { data: course, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .single();

  if (error || !course) throw new NotFoundError('Course not found');
  const active = course.status === 'ACTIVE' || course.is_active !== false;
  if (!active) throw new NotFoundError('Course not found');

  const { data: enrollment } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, course_progress(*)')
    .eq('course_id', courseId)
    .or(enrollmentUserFilter(employee.id))
    .maybeSingle();

  if (!enrollment && !departmentMatches(employee.department, course.target_departments)) {
    throw new ForbiddenError('This course is not available for your department');
  }

  const withThumb = await attachSignedUrls(course);
  const lessons = await listLessonsForCourse(courseId, { withUrls: true });
  const progressMap = new Map((enrollment?.course_progress || []).map((p) => [p.lesson_id, p]));
  const lessonsWithProgress = lessons.map((l, idx) => {
    const prog = progressMap.get(l.id);
    const priorDone = idx === 0 || lessons.slice(0, idx).every((prev) => progressMap.get(prev.id)?.is_completed);
    return {
      ...l,
      progress: prog || null,
      is_completed: Boolean(prog?.is_completed),
      locked: !priorDone && !prog?.is_completed,
    };
  });

  const totalLessons = lessons.length;
  const completedLessons = (enrollment?.course_progress || []).filter((p) => p.is_completed).length;

  return {
    ...withThumb,
    lessons: lessonsWithProgress,
    // Compat: wrap in a single chapter for any UI that still expects chapters
    chapters: [{ id: 'default', title: 'Lessons', order: 1, lessons: lessonsWithProgress }],
    enrollment: enrollment
      ? {
        id: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolled_at,
        completedAt: enrollment.completed_at,
        progressPercent: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
        lessonProgress: enrollment.course_progress || [],
        completed_lessons: completedLessons,
        total_lessons: totalLessons,
      }
      : null,
    totalLessons,
    completed_lessons: completedLessons,
    total_lessons: totalLessons,
    progressPercent: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
  };
};

const getManageCourse = async (courseId) => {
  const { data: course, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .single();

  if (error || !course) throw new NotFoundError('Course not found');

  const withThumb = await attachSignedUrls(course);
  const lessons = await listLessonsForCourse(courseId, { withUrls: true });
  return {
    ...withThumb,
    lessons,
    chapters: [{ id: 'default', title: 'Lessons', order: 1, lessons }],
  };
};

const addLessonToCourse = async (courseId, payload, videoFile) => {
  const { data: course, error: cErr } = await supabaseAdmin
    .from('courses')
    .select('id')
    .eq('id', courseId)
    .single();
  if (cErr || !course) throw new NotFoundError('Course not found');

  const type = payload.type;
  if (!['VIDEO_UPLOAD', 'EXTERNAL_LINK'].includes(type)) {
    throw new BadRequestError('Invalid lesson type');
  }

  let order = payload.order != null ? parseInt(payload.order, 10) : null;
  if (!order || Number.isNaN(order)) {
    const { count } = await supabaseAdmin
      .from('course_lessons')
      .select('id', { count: 'exact', head: true })
      .eq('course_id', courseId);
    order = (count || 0) + 1;
  }

  let videoKey = null;
  let videoUrl = null;
  let duration = payload.videoDuration != null ? parseFloat(payload.videoDuration) : null;

  if (type === 'VIDEO_UPLOAD') {
    if (!videoFile) throw new BadRequestError('Video file is required for VIDEO_UPLOAD');
    if (!duration || duration <= 0) {
      throw new BadRequestError('videoDuration is required for uploaded videos');
    }
    const uploaded = await uploadCourseVideo(videoFile, courseId);
    videoKey = uploaded.path;
    // Store path; signed URL generated on read. Also try public URL for schema video_url.
    const { data: pub } = supabaseAdmin.storage.from(STORAGE_BUCKETS.courseVideos).getPublicUrl(videoKey);
    videoUrl = pub?.publicUrl || videoKey;
  } else {
    const link = payload.externalLink || payload.external_link;
    if (!link) throw new BadRequestError('externalLink is required for EXTERNAL_LINK');
    if (!duration || duration <= 0) {
      throw new BadRequestError('videoDuration is required for external link lessons');
    }
  }

  const { data, error } = await supabaseAdmin
    .from('course_lessons')
    .insert({
      course_id: courseId,
      title: payload.title,
      lesson_order: order,
      type,
      video_key: videoKey,
      video_url: videoUrl,
      external_link: type === 'EXTERNAL_LINK' ? (payload.externalLink || payload.external_link) : null,
      video_duration: duration,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return resolveLessonPlaybackUrl(data);
};

/** Legacy: chapter-based add — create/find a dummy chapter is no longer used; prefer addLessonToCourse */
const addChapter = async (courseId, { title, order }) => ({
  id: 'default',
  course_id: courseId,
  title: title || 'Lessons',
  order: order || 1,
  lessons: [],
});

const addLesson = async (chapterId, payload, videoFile) => {
  // If chapterId is actually a course id (new API), or look up chapter→course
  const { data: asCourse } = await supabaseAdmin
    .from('courses')
    .select('id')
    .eq('id', chapterId)
    .maybeSingle();

  if (asCourse) return addLessonToCourse(chapterId, payload, videoFile);

  const { data: chapter } = await supabaseAdmin
    .from('course_chapters')
    .select('id, course_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (chapter?.course_id) {
    return addLessonToCourse(chapter.course_id, { ...payload, order: payload.order }, videoFile);
  }

  throw new NotFoundError('Course not found');
};

const enrollCourse = async (courseId, employee) => {
  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('id, target_departments, status, is_active')
    .eq('id', courseId)
    .single();

  if (!course) throw new NotFoundError('Course not found');
  const active = course.status === 'ACTIVE' || course.is_active !== false;
  if (!active) throw new NotFoundError('Course not found');
  if (!departmentMatches(employee.department, course.target_departments)) {
    throw new ForbiddenError('This course is not available for your department');
  }

  // Try find existing first (supports dual columns)
  const { data: existing } = await supabaseAdmin
    .from('course_enrollments')
    .select('*')
    .eq('course_id', courseId)
    .or(enrollmentUserFilter(employee.id))
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('course_enrollments')
    .insert({
      course_id: courseId,
      user_id: employee.id,
      employee_id: employee.id,
      status: 'IN_PROGRESS',
    })
    .select()
    .single();

  if (error) {
    // Race / unique conflict
    const { data: again } = await supabaseAdmin
      .from('course_enrollments')
      .select('*')
      .eq('course_id', courseId)
      .or(enrollmentUserFilter(employee.id))
      .maybeSingle();
    if (again) return again;
    throw new BadRequestError(error.message);
  }
  return data;
};

const createEnrollmentsBulk = async ({ courseId, employeeIds }) => {
  if (!courseId) throw new BadRequestError('courseId is required');
  const ids = Array.isArray(employeeIds) ? employeeIds.filter(Boolean) : [];
  if (!ids.length) throw new BadRequestError('employeeIds is required');

  const { data: course } = await supabaseAdmin.from('courses').select('id').eq('id', courseId).single();
  if (!course) throw new NotFoundError('Course not found');

  const results = [];
  for (const empId of ids) {
    const { data: existing } = await supabaseAdmin
      .from('course_enrollments')
      .select('*')
      .eq('course_id', courseId)
      .or(enrollmentUserFilter(empId))
      .maybeSingle();

    if (existing) {
      results.push(existing);
      continue;
    }
    const { data, error } = await supabaseAdmin
      .from('course_enrollments')
      .insert({
        course_id: courseId,
        user_id: empId,
        employee_id: empId,
        status: 'IN_PROGRESS',
      })
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    results.push(data);
  }
  return results;
};

const listEnrollments = async ({ includeArchived = false, archivedOnly = false } = {}) => {
  const baseSelect = `
      id, status, enrolled_at, completed_at, course_id, user_id, employee_id,
      course:course_id(id, title),
      employee:employee_id(id, first_name, last_name, department, email),
      user:user_id(id, first_name, last_name, department, email),
      course_progress(lesson_id, is_completed)
    `;

  const runQuery = (withArchiveCol) => {
    let query = supabaseAdmin
      .from('course_enrollments')
      .select(withArchiveCol ? `is_archived, ${baseSelect}` : baseSelect)
      .order('enrolled_at', { ascending: false });
    if (withArchiveCol) {
      if (archivedOnly) query = query.eq('is_archived', true);
      else if (!includeArchived) query = query.eq('is_archived', false);
    } else if (archivedOnly) {
      return null;
    }
    return query;
  };

  let query = runQuery(true);
  let result = query ? await query : { data: [], error: null };
  let { data, error } = result;
  if (error && String(error.message || '').includes('is_archived')) {
    if (archivedOnly) {
      return [];
    }
    query = runQuery(false);
    ({ data, error } = await query);
  }

  if (error) throw new BadRequestError(error.message);

  const lessonCounts = await getLessonCountsByCourse();

  return (data || []).map((row) => {
    const emp = row.employee || row.user || {};
    const totalLessons = lessonCounts[row.course_id] || 0;
    const completedLessons = (row.course_progress || []).filter((p) => p.is_completed).length;
    const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;
    return {
      id: row.id,
      status: row.status,
      enrolled_at: row.enrolled_at,
      completed_at: row.completed_at,
      course_id: row.course_id,
      course_title: row.course?.title,
      user_id: row.user_id || row.employee_id,
      employee_id: row.employee_id || row.user_id,
      employee_name: [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() || 'Employee',
      department: emp.department,
      completed_lessons: completedLessons,
      total_lessons: totalLessons,
      progress_percent: progressPercent,
      is_archived: Boolean(row.is_archived),
    };
  });
};

const archiveEnrollment = async (enrollmentId) => {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('course_enrollments')
    .select('id, status, is_archived')
    .eq('id', enrollmentId)
    .maybeSingle();

  if (findErr) {
    if (String(findErr.message || '').includes('is_archived')) {
      throw new BadRequestError(
        'Archive is not enabled yet. Run backend/supabase/migrations/20260720_course_enrollment_archive.sql in Supabase.',
      );
    }
    throw new BadRequestError(findErr.message);
  }
  if (!existing) throw new NotFoundError('Enrollment not found');
  if (existing.is_archived) throw new BadRequestError('Enrollment is already archived');
  if (existing.status !== 'COMPLETED') throw new BadRequestError('Only completed enrollments can be archived');

  const { data, error } = await supabaseAdmin
    .from('course_enrollments')
    .update({ is_archived: true })
    .eq('id', enrollmentId)
    .select('id, status, is_archived')
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const checkCourseCompletion = async (enrollmentId, courseId) => {
  const stats = await progressStatsForEnrollment(enrollmentId, courseId);
  if (!stats.total_lessons) return;
  if (stats.completed_lessons >= stats.total_lessons) {
    await supabaseAdmin
      .from('course_enrollments')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('id', enrollmentId);
  }
};

const assertPriorLessonsComplete = async (enrollmentId, courseId, lessonOrder) => {
  const order = Number(lessonOrder || 0);
  if (!order || order <= 1) return;

  const { data: priorLessons, error: lessonErr } = await supabaseAdmin
    .from('course_lessons')
    .select('id')
    .eq('course_id', courseId)
    .lt('lesson_order', order);

  if (lessonErr) throw new BadRequestError(lessonErr.message);
  if (!priorLessons?.length) return;

  const { data: progress, error: progErr } = await supabaseAdmin
    .from('course_progress')
    .select('lesson_id, is_completed')
    .eq('enrollment_id', enrollmentId)
    .in('lesson_id', priorLessons.map((l) => l.id));

  if (progErr) throw new BadRequestError(progErr.message);

  const completed = new Set((progress || []).filter((p) => p.is_completed).map((p) => p.lesson_id));
  const allDone = priorLessons.every((l) => completed.has(l.id));
  if (!allDone) throw new ForbiddenError('Complete previous lessons before continuing');
};

const updateLessonProgress = async (lessonId, employee, watchedSecondsInput, { forceComplete = false } = {}) => {
  const { data: lesson, error: lessonErr } = await supabaseAdmin
    .from('course_lessons')
    .select('*')
    .eq('id', lessonId)
    .single();

  if (lessonErr || !lesson) throw new NotFoundError('Lesson not found');

  const courseId = lesson.course_id;
  let enrollment = await enrollCourse(courseId, employee);
  await assertPriorLessonsComplete(enrollment.id, courseId, lesson.lesson_order);

  const duration = Number(lesson.video_duration || 0);
  if (!duration || duration <= 0) throw new BadRequestError('Lesson duration not configured');

  const { data: existing } = await supabaseAdmin
    .from('course_progress')
    .select('*')
    .eq('enrollment_id', enrollment.id)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  const prior = Number(existing?.watched_seconds || 0);
  // Cap at duration (prevent hacking / seeking past end)
  let incoming = Math.min(Math.max(0, parseFloat(watchedSecondsInput) || 0), duration);
  // Monotonic: never decrease stored progress
  incoming = Math.max(prior, incoming);
  // Reject large forward jumps (anti-skip)
  if (incoming - prior > PROGRESS_JUMP_TOLERANCE) {
    incoming = prior + PROGRESS_JUMP_TOLERANCE;
  }

  const isCompleted = incoming >= (duration - COMPLETION_GRACE_SECONDS)
    || (forceComplete && incoming >= Math.max(duration * 0.85, duration - 30))
    || Boolean(existing?.is_completed);

  const { data: progress, error: progErr } = await supabaseAdmin
    .from('course_progress')
    .upsert({
      enrollment_id: enrollment.id,
      lesson_id: lessonId,
      watched_seconds: Math.round(incoming * 100) / 100,
      is_completed: isCompleted || Boolean(existing?.is_completed),
    }, { onConflict: 'enrollment_id,lesson_id' })
    .select()
    .single();

  if (progErr) throw new BadRequestError(progErr.message);

  if (progress.is_completed) {
    await checkCourseCompletion(enrollment.id, courseId);
    const { data: updatedEnrollment } = await supabaseAdmin
      .from('course_enrollments')
      .select('status, completed_at')
      .eq('id', enrollment.id)
      .single();
    if (updatedEnrollment) enrollment = { ...enrollment, ...updatedEnrollment };
  }

  return {
    lessonId,
    enrollmentId: enrollment.id,
    watchedSeconds: progress.watched_seconds,
    isCompleted: progress.is_completed,
    courseId,
    enrollmentStatus: enrollment.status,
    completedAt: enrollment.completed_at || null,
  };
};

const deleteCourse = async (courseId) => {
  const { error } = await supabaseAdmin
    .from('courses')
    .update({ status: 'ARCHIVED', is_active: false })
    .eq('id', courseId);
  if (error) throw new BadRequestError(error.message);
};

const getLessonVideoUrl = async (lessonId, employee) => {
  const { data: lesson, error: lessonErr } = await supabaseAdmin
    .from('course_lessons')
    .select('*')
    .eq('id', lessonId)
    .single();

  if (lessonErr || !lesson) throw new NotFoundError('Lesson not found');

  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('target_departments, status, is_active')
    .eq('id', lesson.course_id)
    .single();

  if (!course || (course.status === 'ARCHIVED' && course.is_active === false)) {
    throw new NotFoundError('Course not found');
  }
  if (!departmentMatches(employee.department, course.target_departments)) {
    const { data: enr } = await supabaseAdmin
      .from('course_enrollments')
      .select('id')
      .eq('course_id', lesson.course_id)
      .or(enrollmentUserFilter(employee.id))
      .maybeSingle();
    if (!enr) throw new ForbiddenError('This lesson is not available for your department');
  }

  if (lesson.type === 'EXTERNAL_LINK') {
    return { videoUrl: lesson.external_link };
  }

  const resolved = await resolveLessonPlaybackUrl(lesson);
  if (!resolved.playback_url) throw new BadRequestError('This lesson has no uploaded video');
  return { videoUrl: resolved.playback_url };
};

const listTrainingProgressReport = async () => {
  const [{ data: courses, error: cErr }, { data: employees, error: eErr }, { data: enrollments, error: enErr }] = await Promise.all([
    supabaseAdmin.from('courses').select('id, title, target_departments, status, is_active'),
    supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, email, department, employee_code, role, date_of_joining')
      .eq('is_active', true)
      .order('first_name'),
    supabaseAdmin
      .from('course_enrollments')
      .select('id, employee_id, user_id, course_id, status, enrolled_at, completed_at, course_progress(lesson_id, is_completed)'),
  ]);

  if (cErr) throw new BadRequestError(cErr.message);
  if (eErr) throw new BadRequestError(eErr.message);
  if (enErr) throw new BadRequestError(enErr.message);

  const activeCourses = (courses || []).filter((c) => c.status === 'ACTIVE' || c.is_active !== false);
  const lessonCounts = await getLessonCountsByCourse();
  const enrollmentMap = new Map(
    (enrollments || []).map((e) => [`${e.employee_id || e.user_id}:${e.course_id}`, e]),
  );

  const rows = [];
  let totalAssigned = 0;
  let totalCompleted = 0;
  let totalInProgress = 0;

  for (const emp of employees || []) {
    const eligible = activeCourses.filter((c) => departmentMatches(emp.department, c.target_departments));
    const courseItems = eligible.map((course) => {
      const enrollment = enrollmentMap.get(`${emp.id}:${course.id}`);
      const totalLessons = lessonCounts[course.id] || 0;
      const completedLessons = (enrollment?.course_progress || []).filter((p) => p.is_completed).length;
      const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;
      const status = enrollment?.status === 'COMPLETED'
        ? 'COMPLETED'
        : enrollment
          ? 'IN_PROGRESS'
          : 'NOT_STARTED';

      totalAssigned += 1;
      if (status === 'COMPLETED') totalCompleted += 1;
      if (status === 'IN_PROGRESS') totalInProgress += 1;

      return {
        courseId: course.id,
        courseTitle: course.title,
        status,
        progressPercent,
        totalLessons,
        completedLessons,
        completed_lessons: completedLessons,
        total_lessons: totalLessons,
        enrolledAt: enrollment?.enrolled_at || null,
        completedAt: enrollment?.completed_at || null,
      };
    });

    rows.push({
      employeeId: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      email: emp.email,
      department: emp.department,
      employeeCode: emp.employee_code,
      dateOfJoining: emp.date_of_joining,
      assignedCount: courseItems.length,
      completedCount: courseItems.filter((c) => c.status === 'COMPLETED').length,
      courses: courseItems,
    });
  }

  return {
    summary: {
      employeeCount: rows.length,
      courseCount: activeCourses.length,
      totalAssignments: totalAssigned,
      completedAssignments: totalCompleted,
      inProgressAssignments: totalInProgress,
      notStartedAssignments: totalAssigned - totalCompleted - totalInProgress,
    },
    employees: rows,
  };
};

module.exports = {
  listDepartments,
  createCourse,
  updateCourse,
  listManageCourses,
  listEmployeeCourses,
  listCatalog,
  getCourseForEmployee,
  getManageCourse,
  addChapter,
  addLesson,
  addLessonToCourse,
  enrollCourse,
  createEnrollmentsBulk,
  listEnrollments,
  archiveEnrollment,
  updateLessonProgress,
  deleteCourse,
  listTrainingProgressReport,
  getLessonVideoUrl,
};
