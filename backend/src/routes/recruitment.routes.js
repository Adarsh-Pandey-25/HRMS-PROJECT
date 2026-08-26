const express = require('express');
const recruitmentController = require('../controllers/recruitment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/jobs', isManagerOrAbove, recruitmentController.jobs);
router.post('/jobs', isHROrAdmin, recruitmentController.createJob);
router.get('/candidates', isManagerOrAbove, recruitmentController.candidates);
router.post('/candidates', isHROrAdmin, upload.single('resume'), recruitmentController.createCandidate);
router.get('/candidates/:id/resume', isHROrAdmin, recruitmentController.candidateResume);
router.put('/candidates/:id/stage', isHROrAdmin, recruitmentController.moveCandidate);
router.get('/interviews', isManagerOrAbove, recruitmentController.interviews);
router.post('/interviews', isHROrAdmin, recruitmentController.createInterview);
router.put('/interviews/:id', isHROrAdmin, recruitmentController.updateInterviewOutcome);
router.get('/offers', isHROrAdmin, recruitmentController.offers);
router.post('/offers', isHROrAdmin, recruitmentController.createOffer);
router.get('/candidates/:id/checklist', isHROrAdmin, recruitmentController.getChecklist);
router.patch('/candidates/:id/checklist/:templateId', isHROrAdmin, recruitmentController.updateChecklistItem);

module.exports = router;
