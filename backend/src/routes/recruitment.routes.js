const express = require('express');
const recruitmentController = require('../controllers/recruitment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/jobs', isManagerOrAbove, recruitmentController.jobs);
router.post('/jobs', isHROrAdmin, recruitmentController.createJob);
router.get('/candidates', isManagerOrAbove, recruitmentController.candidates);
router.put('/candidates/:id/stage', isHROrAdmin, recruitmentController.moveCandidate);
router.get('/interviews', isManagerOrAbove, recruitmentController.interviews);
router.get('/offers', isHROrAdmin, recruitmentController.offers);

module.exports = router;
