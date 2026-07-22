const express = require('express');
const trainingController = require('../controllers/training.controller');
const courseController = require('../controllers/course.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { uploadVideo, uploadThumbnail } = require('../middleware/videoUpload.middleware');
const { validate } = require('../middleware/validation.middleware');
const {
  trainingCreateRules,
  courseCreateRules,
  courseChapterRules,
  courseLessonRules,
  lessonProgressRules,
  uuidParam,
  paginationQuery,
} = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// ----- LMS (flat course → lessons) -----
router.get('/departments', isManagerOrAbove, courseController.listDepartments);
router.get('/progress-report', isManagerOrAbove, courseController.trainingProgressReport);

router.get('/catalog', isEmployee, courseController.listCatalog);
router.get('/enrollments', isHROrAdmin, courseController.listEnrollments);
router.post('/enrollments', isHROrAdmin, courseController.createEnrollments);
router.put('/enrollments/:id/archive', isHROrAdmin, uuidParam(), validate, courseController.archiveEnrollment);
router.post('/enrollments/:id/archive', isHROrAdmin, uuidParam(), validate, courseController.archiveEnrollment);

router.post('/courses', isManagerOrAbove, uploadThumbnail.single('thumbnail'), courseCreateRules, validate, courseController.createCourse);
router.get('/courses/manage', isManagerOrAbove, courseController.listManageCourses);
router.get('/courses/manage/:id', isManagerOrAbove, uuidParam(), validate, courseController.getManageCourse);
router.put('/courses/:id', isManagerOrAbove, uuidParam(), uploadThumbnail.single('thumbnail'), validate, courseController.updateCourse);
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

// ----- Legacy training endpoints -----
router.post('/create', isHROrAdmin, upload.single('materials'), trainingCreateRules, validate, trainingController.create);
router.get('/all-trainings', paginationQuery, validate, trainingController.allTrainings);
router.get('/my-trainings', isEmployee, trainingController.myTrainings);
router.post('/assign', isManagerOrAbove, trainingController.assign);
router.put('/:id/complete', isEmployee, uuidParam(), validate, trainingController.complete);
router.get('/:id/participants', uuidParam(), validate, trainingController.participants);
router.delete('/:id', isHROrAdmin, uuidParam(), validate, trainingController.remove);

module.exports = router;
