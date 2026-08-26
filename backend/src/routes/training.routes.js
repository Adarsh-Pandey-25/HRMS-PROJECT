const express = require('express');
const courseController = require('../controllers/course.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { uploadVideo, uploadThumbnail } = require('../middleware/videoUpload.middleware');
const { validate } = require('../middleware/validation.middleware');
const {
  courseCreateRules,
  courseChapterRules,
  courseLessonRules,
  createEnrollmentsRules,
  lessonProgressRules,
  uuidParam,
} = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// ----- LMS (flat course → lessons) -----
router.get('/departments', isManagerOrAbove, courseController.listDepartments);
router.get('/progress-report', isManagerOrAbove, courseController.trainingProgressReport);
router.post('/remind/:employeeId', isManagerOrAbove, uuidParam('employeeId'), validate, courseController.sendTrainingReminder);

router.get('/catalog', isEmployee, courseController.listCatalog);
router.get('/enrollments', isHROrAdmin, courseController.listEnrollments);
router.post('/enrollments', isHROrAdmin, createEnrollmentsRules, validate, courseController.createEnrollments);
router.put('/enrollments/:id/archive', isHROrAdmin, uuidParam(), validate, courseController.archiveEnrollment);
router.post('/enrollments/:id/archive', isHROrAdmin, uuidParam(), validate, courseController.archiveEnrollment);

router.post('/courses', isManagerOrAbove, uploadThumbnail.single('thumbnail'), courseCreateRules, validate, courseController.createCourse);
router.get('/courses/manage', isManagerOrAbove, courseController.listManageCourses);
router.get('/courses/manage/:id', isManagerOrAbove, uuidParam(), validate, courseController.getManageCourse);
router.put('/courses/:id', isManagerOrAbove, uuidParam(), uploadThumbnail.single('thumbnail'), validate, courseController.updateCourse);
router.post('/courses/:id/archive', isManagerOrAbove, uuidParam(), validate, courseController.archiveCourse);
router.delete('/courses/:id', isManagerOrAbove, uuidParam(), validate, courseController.deleteCourse);
router.post(
  '/courses/:id/lessons',
  isManagerOrAbove,
  uuidParam(),
  uploadVideo.single('video'),
  courseLessonRules,
  validate,
  courseController.addLessonToCourse,
);
router.post('/courses/:id/chapters', isManagerOrAbove, uuidParam(), courseChapterRules, validate, courseController.addChapter);
router.post('/courses/:id/enroll', isEmployee, uuidParam(), validate, courseController.enrollCourse);
router.get('/courses', isEmployee, courseController.listEmployeeCourses);
router.get('/courses/:id', isEmployee, uuidParam(), validate, courseController.getCourse);
router.post('/chapters/:id/lessons', isManagerOrAbove, uuidParam('id'), uploadVideo.single('video'), courseLessonRules, validate, courseController.addLesson);
router.post('/lessons/:id/progress', isEmployee, uuidParam(), lessonProgressRules, validate, courseController.updateProgress);
router.get('/lessons/:id/video-url', isEmployee, uuidParam(), validate, courseController.getLessonVideoUrl);

module.exports = router;
