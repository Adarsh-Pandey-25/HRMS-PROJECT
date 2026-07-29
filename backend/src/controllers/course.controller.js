const courseService = require('../services/course.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const listDepartments = async (req, res, next) => {
  try {
    const data = await courseService.listDepartments();
    successResponse(res, 'Departments fetched', data);
  } catch (err) { next(err); }
};

const createCourse = async (req, res, next) => {
  try {
    const targetDepartments = typeof req.body.targetDepartments === 'string'
      ? JSON.parse(req.body.targetDepartments)
      : (req.body.targetDepartments || req.body.target_departments);

    const data = await courseService.createCourse(
      { ...req.body, targetDepartments },
      req.user.id,
      req.file,
      companyIdOf(req),
    );
    successResponse(res, 'Course created', data, null, 201);
  } catch (err) { next(err); }
};

const updateCourse = async (req, res, next) => {
  try {
    const rawTargets = req.body.targetDepartments || req.body.target_departments;
    const targetDepartments = rawTargets
      ? (typeof rawTargets === 'string' ? JSON.parse(rawTargets) : rawTargets)
      : undefined;

    const data = await courseService.updateCourse(
      req.params.id,
      { ...req.body, targetDepartments },
      req.file,
    );
    successResponse(res, 'Course updated', data);
  } catch (err) { next(err); }
};

const listManageCourses = async (req, res, next) => {
  try {
    const data = await courseService.listManageCourses(companyIdOf(req));
    successResponse(res, 'Courses fetched', data);
  } catch (err) { next(err); }
};

const listEmployeeCourses = async (req, res, next) => {
  try {
    const data = await courseService.listCatalog(req.user, companyIdOf(req));
    successResponse(res, 'Courses fetched', data);
  } catch (err) { next(err); }
};

const listCatalog = listEmployeeCourses;

const getCourse = async (req, res, next) => {
  try {
    const data = await courseService.getCourseForEmployee(req.params.id, req.user);
    successResponse(res, 'Course fetched', data);
  } catch (err) { next(err); }
};

const getManageCourse = async (req, res, next) => {
  try {
    const data = await courseService.getManageCourse(req.params.id);
    successResponse(res, 'Course fetched', data);
  } catch (err) { next(err); }
};

const addChapter = async (req, res, next) => {
  try {
    const data = await courseService.addChapter(req.params.id, req.body);
    successResponse(res, 'Chapter added', data, null, 201);
  } catch (err) { next(err); }
};

const addLessonToCourse = async (req, res, next) => {
  try {
    const data = await courseService.addLessonToCourse(req.params.id, {
      ...req.body,
      order: req.body.order || req.body.lesson_order || req.body.lessonOrder,
      externalLink: req.body.externalLink || req.body.external_link,
      videoDuration: req.body.videoDuration || req.body.video_duration,
    }, req.file);
    successResponse(res, 'Lesson added', data, null, 201);
  } catch (err) { next(err); }
};

const addLesson = async (req, res, next) => {
  try {
    const data = await courseService.addLesson(req.params.id, {
      ...req.body,
      externalLink: req.body.externalLink || req.body.external_link,
      videoDuration: req.body.videoDuration || req.body.video_duration,
    }, req.file);
    successResponse(res, 'Lesson added', data, null, 201);
  } catch (err) { next(err); }
};

const enrollCourse = async (req, res, next) => {
  try {
    const data = await courseService.enrollCourse(req.params.id, req.user);
    successResponse(res, 'Enrolled in course', data, null, 201);
  } catch (err) { next(err); }
};

const createEnrollments = async (req, res, next) => {
  try {
    const courseId = req.body.course_id || req.body.courseId;
    const employeeIds = req.body.employee_ids || req.body.employeeIds || req.body.user_ids || [];
    const data = await courseService.createEnrollmentsBulk({ courseId, employeeIds });
    successResponse(res, 'Enrollments created', data, null, 201);
  } catch (err) { next(err); }
};

const listEnrollments = async (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const archivedOnly = req.query.archivedOnly === 'true';
    const data = await courseService.listEnrollments({ includeArchived, archivedOnly });
    successResponse(res, 'Enrollments fetched', data);
  } catch (err) { next(err); }
};

const archiveEnrollment = async (req, res, next) => {
  try {
    const data = await courseService.archiveEnrollment(req.params.id);
    successResponse(res, 'Enrollment archived', data);
  } catch (err) { next(err); }
};

const updateProgress = async (req, res, next) => {
  try {
    const watched = req.body.watchedSeconds ?? req.body.watched_seconds;
    const forceComplete = Boolean(req.body.forceComplete ?? req.body.force_complete);
    const data = await courseService.updateLessonProgress(
      req.params.id,
      req.user,
      watched,
      { forceComplete },
    );
    successResponse(res, 'Progress updated', data);
  } catch (err) { next(err); }
};

const deleteCourse = async (req, res, next) => {
  try {
    await courseService.deleteCourse(req.params.id);
    successResponse(res, 'Course deleted');
  } catch (err) { next(err); }
};

const archiveCourse = async (req, res, next) => {
  try {
    const data = await courseService.archiveCourse(req.params.id);
    successResponse(res, 'Course archived', data);
  } catch (err) { next(err); }
};

const trainingProgressReport = async (req, res, next) => {
  try {
    const data = await courseService.listTrainingProgressReport();
    successResponse(res, 'Training progress fetched', data);
  } catch (err) { next(err); }
};

const getLessonVideoUrl = async (req, res, next) => {
  try {
    const data = await courseService.getLessonVideoUrl(req.params.id, req.user);
    successResponse(res, 'Video URL fetched', data);
  } catch (err) { next(err); }
};

module.exports = {
  listDepartments,
  createCourse,
  updateCourse,
  listManageCourses,
  listEmployeeCourses,
  listCatalog,
  getCourse,
  getManageCourse,
  addChapter,
  addLesson,
  addLessonToCourse,
  enrollCourse,
  createEnrollments,
  listEnrollments,
  archiveEnrollment,
  updateProgress,
  deleteCourse,
  archiveCourse,
  trainingProgressReport,
  getLessonVideoUrl,
};
