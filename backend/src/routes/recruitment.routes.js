const express = require('express');
const recruitmentController = require('../controllers/recruitment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { uuidParam } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('recruitment'));

router.get('/jobs', isManagerOrAbove, recruitmentController.jobs);
router.post('/jobs', isHROrAdmin, recruitmentController.createJob);
router.get('/candidates', isManagerOrAbove, recruitmentController.candidates);
router.post('/candidates', isHROrAdmin, upload.single('resume'), recruitmentController.createCandidate);
router.get('/candidates/:id/resume', isHROrAdmin, uuidParam(), validate, recruitmentController.candidateResume);
router.put('/candidates/:id/stage', isHROrAdmin, uuidParam(), validate, recruitmentController.moveCandidate);
router.get('/interviews', isManagerOrAbove, recruitmentController.interviews);
router.post('/interviews', isHROrAdmin, recruitmentController.createInterview);
router.put('/interviews/:id', isHROrAdmin, uuidParam(), validate, recruitmentController.updateInterviewOutcome);
router.get('/offers', isHROrAdmin, recruitmentController.offers);
router.post('/offers', isHROrAdmin, recruitmentController.createOffer);
router.put('/offers/:id', isHROrAdmin, uuidParam(), validate, recruitmentController.updateOfferStatus);
router.get('/candidates/:id/checklist', isHROrAdmin, uuidParam(), validate, recruitmentController.getChecklist);
router.patch(
  '/candidates/:id/checklist/:templateId',
  isHROrAdmin,
  [...uuidParam('id'), ...uuidParam('templateId')],
  validate,
  recruitmentController.updateChecklistItem,
);

module.exports = router;
