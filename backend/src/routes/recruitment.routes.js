const express = require('express');
const recruitmentController = require('../controllers/recruitment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { uuidParam } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('recruitment'));

// Settings → User & Role Management → Recruitment: View = jobs and candidates,
// Create = add a job or candidate, Manage = the pipeline, interviews and offers
// (the Interviews and Offers screens need Manage, and read the lists too).
const can = (action) => requirePermission('recruitment', action);

router.get('/jobs', isManagerOrAbove, can(['view', 'manage']), recruitmentController.jobs);
router.post('/jobs', isHROrAdmin, can('create'), recruitmentController.createJob);
router.get('/candidates', isManagerOrAbove, can(['view', 'manage']), recruitmentController.candidates);
router.post('/candidates', isHROrAdmin, can('create'), upload.single('resume'), recruitmentController.createCandidate);
router.get('/candidates/:id/resume', isHROrAdmin, can(['view', 'manage']), uuidParam(), validate, recruitmentController.candidateResume);
router.put('/candidates/:id/stage', isHROrAdmin, can('manage'), uuidParam(), validate, recruitmentController.moveCandidate);
router.get('/interviews', isManagerOrAbove, can(['view', 'manage']), recruitmentController.interviews);
router.post('/interviews', isHROrAdmin, can('manage'), recruitmentController.createInterview);
router.put('/interviews/:id', isHROrAdmin, can('manage'), uuidParam(), validate, recruitmentController.updateInterviewOutcome);
router.get('/offers', isHROrAdmin, can('manage'), recruitmentController.offers);
router.post('/offers', isHROrAdmin, can('manage'), recruitmentController.createOffer);
router.put('/offers/:id', isHROrAdmin, can('manage'), uuidParam(), validate, recruitmentController.updateOfferStatus);
router.get('/candidates/:id/checklist', isHROrAdmin, can('manage'), uuidParam(), validate, recruitmentController.getChecklist);
router.patch(
  '/candidates/:id/checklist/:templateId',
  isHROrAdmin,
  can('manage'),
  [...uuidParam('id'), ...uuidParam('templateId')],
  validate,
  recruitmentController.updateChecklistItem,
);

module.exports = router;
