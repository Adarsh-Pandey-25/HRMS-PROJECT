const express = require('express');
const courseController = require('../controllers/course.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { uploadVideo, uploadThumbnail } = require('../middleware/videoUpload.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const {
  courseCreateRules,
  courseChapterRules,
  courseChapterUpdateRules,
  courseLessonRules,
  createEnrollmentsRules,
  lessonProgressRules,
  uuidParam,
} = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('training'));

// Settings → User & Role Management → Training → Manage: courses, lessons,
// chapters and enrollments. Taking a course never needs it.
const manageTraining = requirePermission('training', 'manage');
const viewTrainingReports = requirePermission('training', ['view', 'manage']);

// ----- LMS (flat course → lessons) -----
router.get('/departments', isManagerOrAbove, viewTrainingReports, courseController.listDepartments);
router.get('/progress-report', isManagerOrAbove, viewTrainingReports, courseController.trainingProgressReport);
router.post('/remind/:employeeId', isManagerOrAbove, manageTraining, uuidParam('employeeId'), validate, courseController.sendTrainingReminder);

router.get('/catalog', isEmployee, courseController.listCatalog);
router.get('/enrollments', isHROrAdmin, manageTraining, courseController.listEnrollments);
router.post('/enrollments', isHROrAdmin, manageTraining, createEnrollmentsRules, validate, courseController.createEnrollments);
router.put('/enrollments/:id/archive', isHROrAdmin, manageTraining, uuidParam(), validate, courseController.archiveEnrollment);
router.post('/enrollments/:id/archive', isHROrAdmin, manageTraining, uuidParam(), validate, courseController.archiveEnrollment);

router.post('/courses', isManagerOrAbove, manageTraining, uploadThumbnail.single('thumbnail'), courseCreateRules, validate, courseController.createCourse);
router.get('/courses/manage', isManagerOrAbove, manageTraining, courseController.listManageCourses);
router.get('/courses/manage/:id', isManagerOrAbove, manageTraining, uuidParam(), validate, courseController.getManageCourse);
router.put('/courses/:id', isManagerOrAbove, manageTraining, uuidParam(), uploadThumbnail.single('thumbnail'), validate, courseController.updateCourse);
router.post('/courses/:id/archive', isManagerOrAbove, manageTraining, uuidParam(), validate, courseController.archiveCourse);
router.delete('/courses/:id', isManagerOrAbove, manageTraining, uuidParam(), validate, courseController.deleteCourse);
router.post(
  '/courses/:id/lessons',
  isManagerOrAbove,
  manageTraining,
  uuidParam(),
  uploadVideo.single('video'),
  courseLessonRules,
  validate,
  courseController.addLessonToCourse,
);
// Chapters group a course's lessons for display. lesson_order stays the watch
// sequence, so none of these change the order lessons unlock in.
router.get('/courses/:id/chapters', isManagerOrAbove, manageTraining, uuidParam(), validate, courseController.listChapters);
router.post('/courses/:id/chapters', isManagerOrAbove, manageTraining, uuidParam(), courseChapterRules, validate, courseController.addChapter);
router.put('/chapters/:id', isManagerOrAbove, manageTraining, uuidParam(), courseChapterUpdateRules, validate, courseController.updateChapter);
router.delete('/chapters/:id', isManagerOrAbove, manageTraining, uuidParam(), validate, courseController.deleteChapter);
router.put('/lessons/:id/chapter', isManagerOrAbove, manageTraining, uuidParam(), validate, courseController.setLessonChapter);
router.post('/courses/:id/enroll', isEmployee, uuidParam(), validate, courseController.enrollCourse);
router.get('/courses', isEmployee, courseController.listEmployeeCourses);
router.get('/courses/:id', isEmployee, uuidParam(), validate, courseController.getCourse);
router.post('/chapters/:id/lessons', isManagerOrAbove, manageTraining, uuidParam('id'), uploadVideo.single('video'), courseLessonRules, validate, courseController.addLesson);
router.post('/lessons/:id/progress', isEmployee, uuidParam(), lessonProgressRules, validate, courseController.updateProgress);
router.get('/lessons/:id/video-url', isEmployee, uuidParam(), validate, courseController.getLessonVideoUrl);

module.exports = router;
