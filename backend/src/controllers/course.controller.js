const courseService = require('../services/course.service');
const { successResponse } = require('../utils/helpers');

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
      : req.body.targetDepartments;

    const data = await courseService.createCourse(
      { ...req.body, targetDepartments },
      req.user.id,
      req.file,
    );
    successResponse(res, 'Course created', data, null, 201);
  } catch (err) { next(err); }
};

const updateCourse = async (req, res, next) => {
  try {
    const targetDepartments = req.body.targetDepartments
      ? (typeof req.body.targetDepartments === 'string'
        ? JSON.parse(req.body.targetDepartments)
        : req.body.targetDepartments)
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
    const data = await courseService.listManageCourses();
    successResponse(res, 'Courses fetched', data);
  } catch (err) { next(err); }
};

const listEmployeeCourses = async (req, res, next) => {
  try {
    const data = await courseService.listEmployeeCourses(req.user);
    successResponse(res, 'Courses fetched', data);
  } catch (err) { next(err); }
};

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

const addLesson = async (req, res, next) => {
  try {
    const data = await courseService.addLesson(req.params.id, req.body, req.file);
    successResponse(res, 'Lesson added', data, null, 201);
  } catch (err) { next(err); }
};

const enrollCourse = async (req, res, next) => {
  try {
    const data = await courseService.enrollCourse(req.params.id, req.user);
    successResponse(res, 'Enrolled in course', data, null, 201);
  } catch (err) { next(err); }
};

const updateProgress = async (req, res, next) => {
  try {
    const data = await courseService.updateLessonProgress(
      req.params.id,
      req.user,
      req.body.watchedSeconds,
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
  getCourse,
  getManageCourse,
  addChapter,
  addLesson,
  enrollCourse,
  updateProgress,
  deleteCourse,
  trainingProgressReport,
  getLessonVideoUrl,
};
