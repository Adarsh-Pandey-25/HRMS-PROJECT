const { supabaseAdmin } = require('../config/supabase');
const { uploadCourseVideo, uploadCourseThumbnail, getSignedUrl } = require('./storage.service');
const { STORAGE_BUCKETS } = require('../utils/constants');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

const COMPLETION_GRACE_SECONDS = 5;
const PROGRESS_JUMP_TOLERANCE = 12;

const normalizeDept = (dept) => (dept || '').trim().toLowerCase();

const departmentMatches = (employeeDept, targetDepartments = []) => {
  const emp = normalizeDept(employeeDept);
  if (!emp) return false;
  return targetDepartments.some((d) => normalizeDept(d) === emp);
};

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
  return result;
};

const attachLessonVideoUrls = async (lessons) => Promise.all(
  (lessons || []).map(async (lesson) => {
    if (lesson.type === 'VIDEO_UPLOAD' && lesson.video_key) {
      return {
        ...lesson,
        video_url: await getSignedUrl(STORAGE_BUCKETS.trainingMaterials, lesson.video_key, 7200),
      };
    }
    return lesson;
  }),
);

const getCourseStructure = async (courseId, { withVideoUrls = false } = {}) => {
  const { data: chapters, error: chErr } = await supabaseAdmin
    .from('course_chapters')
    .select('*, lessons(*)')
    .eq('course_id', courseId)
    .order('order', { ascending: true });

  if (chErr) throw new BadRequestError(chErr.message);

  const sorted = (chapters || []).map((ch) => ({
    ...ch,
    lessons: (ch.lessons || []).sort((a, b) => a.order - b.order),
  }));

  if (withVideoUrls) {
    for (const ch of sorted) {
      ch.lessons = await attachLessonVideoUrls(ch.lessons);
    }
  }

  return sorted;
};

const createCourse = async (payload, userId, thumbnailFile) => {
  let thumbnailKey = null;
  if (thumbnailFile) {
    const { path } = await uploadCourseThumbnail(thumbnailFile);
    thumbnailKey = path;
  }

  const { data, error } = await supabaseAdmin
    .from('courses')
    .insert({
      title: payload.title,
      description: payload.description || null,
      target_departments: payload.targetDepartments || [],
      thumbnail_key: thumbnailKey,
      created_by: userId,
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
  if (payload.targetDepartments !== undefined) updates.target_departments = payload.targetDepartments;
  if (payload.isActive !== undefined) updates.is_active = payload.isActive;

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

const listManageCourses = async () => {
  const { data, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new BadRequestError(error.message);

  return Promise.all((data || []).map(attachSignedUrls));
};

const listEmployeeCourses = async (employee) => {
  const dept = employee.department;
  if (!dept) return [];

  const [{ data: courses, error }, { data: enrollments }, lessonCounts] = await Promise.all([
    supabaseAdmin
      .from('courses')
      .select('id, title, description, thumbnail_key, target_departments, is_active, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('course_enrollments')
      .select('id, course_id, status, enrolled_at, completed_at, lesson_progress(lesson_id, is_completed)')
      .eq('employee_id', employee.id),
    getLessonCountsByCourse(),
  ]);

  if (error) throw new BadRequestError(error.message);

  const matched = (courses || []).filter((c) => departmentMatches(dept, c.target_departments));
  const enrollmentMap = new Map((enrollments || []).map((e) => [e.course_id, e]));

  return Promise.all(matched.map(async (course) => {
    const withThumb = await attachSignedUrls(course);
    const enrollment = enrollmentMap.get(course.id);
    const totalLessons = lessonCounts[course.id] || 0;
    const completedLessons = (enrollment?.lesson_progress || []).filter((p) => p.is_completed).length;
    const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

    return {
      ...withThumb,
      enrollment: enrollment ? {
        id: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolled_at,
        completedAt: enrollment.completed_at,
        progressPercent,
      } : null,
      totalLessons,
      progressPercent,
    };
  }));
};

const getCourseForEmployee = async (courseId, employee) => {
  const { data: course, error } = await supabaseAdmin
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .eq('is_active', true)
    .single();

  if (error || !course) throw new NotFoundError('Course not found');

  if (!departmentMatches(employee.department, course.target_departments)) {
    throw new ForbiddenError('This course is not available for your department');
  }

  const withThumb = await attachSignedUrls(course);
  const chapters = await getCourseStructure(courseId, { withVideoUrls: false });

  let { data: enrollment } = await supabaseAdmin
    .from('course_enrollments')
    .select('*, lesson_progress(*)')
    .eq('course_id', courseId)
    .eq('employee_id', employee.id)
    .maybeSingle();

  const totalLessons = chapters.reduce((sum, ch) => sum + ch.lessons.length, 0);
  const completedLessons = (enrollment?.lesson_progress || []).filter((p) => p.is_completed).length;
  const progressPercent = totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return {
    ...withThumb,
    chapters,
    enrollment: enrollment ? {
      id: enrollment.id,
      status: enrollment.status,
      enrolledAt: enrollment.enrolled_at,
      completedAt: enrollment.completed_at,
      progressPercent,
      lessonProgress: enrollment.lesson_progress || [],
    } : null,
    totalLessons,
    progressPercent,
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
  const chapters = await getCourseStructure(courseId, { withVideoUrls: false });
  return { ...withThumb, chapters };
};

const addChapter = async (courseId, { title, order }) => {
  const { data, error } = await supabaseAdmin
    .from('course_chapters')
    .insert({ course_id: courseId, title, order })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return { ...data, lessons: [] };
};

const addLesson = async (chapterId, payload, videoFile) => {
  const { data: chapter, error: chErr } = await supabaseAdmin
    .from('course_chapters')
    .select('id, course_id')
    .eq('id', chapterId)
    .single();

  if (chErr || !chapter) throw new NotFoundError('Chapter not found');

  const type = payload.type;
  if (!['VIDEO_UPLOAD', 'EXTERNAL_LINK'].includes(type)) {
    throw new BadRequestError('Invalid lesson type');
  }

  let videoKey = null;
  if (type === 'VIDEO_UPLOAD') {
    if (!videoFile) throw new BadRequestError('Video file is required for VIDEO_UPLOAD');
    if (!payload.videoDuration || payload.videoDuration <= 0) {
      throw new BadRequestError('videoDuration is required for uploaded videos');
    }
    const { path } = await uploadCourseVideo(videoFile, chapter.course_id);
    videoKey = path;
  } else if (!payload.externalLink) {
    throw new BadRequestError('externalLink is required for EXTERNAL_LINK');
  }

  const duration = payload.videoDuration ? parseFloat(payload.videoDuration) : null;
  if (type === 'EXTERNAL_LINK' && (!duration || duration <= 0)) {
    throw new BadRequestError('videoDuration is required for external links (estimated watch time)');
  }

  const { data, error } = await supabaseAdmin
    .from('lessons')
    .insert({
      chapter_id: chapterId,
      title: payload.title,
      order: payload.order,
      type,
      video_key: videoKey,
      external_link: type === 'EXTERNAL_LINK' ? payload.externalLink : null,
      video_duration: duration,
    })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);

  const [withUrl] = await attachLessonVideoUrls([data]);
  return withUrl;
};

const enrollCourse = async (courseId, employee) => {
  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('id, target_departments, is_active')
    .eq('id', courseId)
    .single();

  if (!course || !course.is_active) throw new NotFoundError('Course not found');
  if (!departmentMatches(employee.department, course.target_departments)) {
    throw new ForbiddenError('This course is not available for your department');
  }

  const { data, error } = await supabaseAdmin
    .from('course_enrollments')
    .upsert({
      course_id: courseId,
      employee_id: employee.id,
      status: 'IN_PROGRESS',
    }, { onConflict: 'employee_id,course_id' })
    .select()
    .single();

  if (error) throw new BadRequestError(error.message);
  return data;
};

const getAllLessonIdsInOrder = async (courseId) => {
  const { data: chapters, error } = await supabaseAdmin
    .from('course_chapters')
    .select('order, lessons(id, order)')
    .eq('course_id', courseId)
    .order('order', { ascending: true });

  if (error) throw new BadRequestError(error.message);

  return (chapters || [])
    .sort((a, b) => a.order - b.order)
    .flatMap((ch) => (ch.lessons || []).sort((a, b) => a.order - b.order).map((l) => l.id));
};

const getLessonVideoUrl = async (lessonId, employee) => {
  const { data: lesson, error: lessonErr } = await supabaseAdmin
    .from('lessons')
    .select('id, type, video_key, chapter:chapter_id(course_id)')
    .eq('id', lessonId)
    .single();

  if (lessonErr || !lesson) throw new NotFoundError('Lesson not found');

  const { data: course } = await supabaseAdmin
    .from('courses')
    .select('target_departments, is_active')
    .eq('id', lesson.chapter.course_id)
    .single();

  if (!course?.is_active) throw new NotFoundError('Course not found');
  if (!departmentMatches(employee.department, course.target_departments)) {
    throw new ForbiddenError('This lesson is not available for your department');
  }
  if (lesson.type !== 'VIDEO_UPLOAD' || !lesson.video_key) {
    throw new BadRequestError('This lesson has no uploaded video');
  }

  return {
    videoUrl: await getSignedUrl(STORAGE_BUCKETS.trainingMaterials, lesson.video_key, 7200),
  };
};

const checkCourseCompletion = async (enrollmentId, courseId) => {
  const lessonIds = await getAllLessonIdsInOrder(courseId);
  if (!lessonIds.length) return;

  const { data: progress } = await supabaseAdmin
    .from('lesson_progress')
    .select('lesson_id, is_completed')
    .eq('enrollment_id', enrollmentId);

  const completedSet = new Set((progress || []).filter((p) => p.is_completed).map((p) => p.lesson_id));
  const allDone = lessonIds.every((id) => completedSet.has(id));

  if (allDone) {
    await supabaseAdmin
      .from('course_enrollments')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('id', enrollmentId);
  }
};

const updateLessonProgress = async (lessonId, employee, watchedSecondsInput) => {
  const { data: lesson, error: lessonErr } = await supabaseAdmin
    .from('lessons')
    .select('*, chapter:chapter_id(course_id)')
    .eq('id', lessonId)
    .single();

  if (lessonErr || !lesson) throw new NotFoundError('Lesson not found');

  const courseId = lesson.chapter.course_id;
  const duration = lesson.video_duration;
  if (!duration || duration <= 0) throw new BadRequestError('Lesson duration not configured');

  let enrollment = await enrollCourse(courseId, employee);

  const { data: existing } = await supabaseAdmin
    .from('lesson_progress')
    .select('*')
    .eq('enrollment_id', enrollment.id)
    .eq('lesson_id', lessonId)
    .maybeSingle();

  const prior = existing?.watched_seconds || 0;
  let incoming = Math.min(parseFloat(watchedSecondsInput) || 0, duration);

  if (incoming > duration) {
    throw new BadRequestError('watchedSeconds exceeds video duration');
  }

  if (incoming > prior + PROGRESS_JUMP_TOLERANCE) {
    throw new BadRequestError('Progress cannot skip ahead');
  }

  incoming = Math.max(prior, incoming);
  const isCompleted = incoming >= (duration - COMPLETION_GRACE_SECONDS);

  const progressPayload = {
    enrollment_id: enrollment.id,
    lesson_id: lessonId,
    watched_seconds: Math.round(incoming * 100) / 100,
    is_completed: isCompleted,
  };

  const { data: progress, error: progErr } = await supabaseAdmin
    .from('lesson_progress')
    .upsert(progressPayload, { onConflict: 'enrollment_id,lesson_id' })
    .select()
    .single();

  if (progErr) throw new BadRequestError(progErr.message);

  if (isCompleted) {
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
  const { error } = await supabaseAdmin.from('courses').delete().eq('id', courseId);
  if (error) throw new BadRequestError(error.message);
};

const getLessonCountsByCourse = async () => {
  const { data: chapters, error } = await supabaseAdmin
    .from('course_chapters')
    .select('course_id, lessons(id)');

  if (error) throw new BadRequestError(error.message);

  const counts = {};
  for (const ch of chapters || []) {
    counts[ch.course_id] = (counts[ch.course_id] || 0) + (ch.lessons?.length || 0);
  }
  return counts;
};

const listTrainingProgressReport = async () => {
  const [{ data: courses, error: cErr }, { data: employees, error: eErr }, { data: enrollments, error: enErr }] = await Promise.all([
    supabaseAdmin.from('courses').select('id, title, target_departments').eq('is_active', true),
    supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, email, department, employee_code, role')
      .eq('is_active', true)
      .eq('role', 'employee')
      .order('first_name'),
    supabaseAdmin
      .from('course_enrollments')
      .select('id, employee_id, course_id, status, enrolled_at, completed_at, lesson_progress(lesson_id, is_completed)'),
  ]);

  if (cErr) throw new BadRequestError(cErr.message);
  if (eErr) throw new BadRequestError(eErr.message);
  if (enErr) throw new BadRequestError(enErr.message);

  const lessonCounts = await getLessonCountsByCourse();
  const enrollmentMap = new Map(
    (enrollments || []).map((e) => [`${e.employee_id}:${e.course_id}`, e]),
  );

  const rows = [];
  let totalAssigned = 0;
  let totalCompleted = 0;
  let totalInProgress = 0;

  for (const emp of employees || []) {
    const eligible = (courses || []).filter((c) => departmentMatches(emp.department, c.target_departments));
    const courseItems = eligible.map((course) => {
      const enrollment = enrollmentMap.get(`${emp.id}:${course.id}`);
      const totalLessons = lessonCounts[course.id] || 0;
      const completedLessons = (enrollment?.lesson_progress || []).filter((p) => p.is_completed).length;
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
      assignedCount: courseItems.length,
      completedCount: courseItems.filter((c) => c.status === 'COMPLETED').length,
      courses: courseItems,
    });
  }

  return {
    summary: {
      employeeCount: rows.length,
      courseCount: (courses || []).length,
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
  getCourseForEmployee,
  getManageCourse,
  addChapter,
  addLesson,
  enrollCourse,
  updateLessonProgress,
  deleteCourse,
  listTrainingProgressReport,
  getLessonVideoUrl,
};
