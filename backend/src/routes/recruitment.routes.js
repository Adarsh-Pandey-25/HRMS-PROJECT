const express = require('express');
const recruitmentController = require('../controllers/recruitment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/jobs', recruitmentController.jobs);
router.post('/jobs', isHROrAdmin, recruitmentController.createJob);
router.get('/candidates', recruitmentController.candidates);
router.put('/candidates/:id/stage', isHROrAdmin, recruitmentController.moveCandidate);
router.get('/interviews', recruitmentController.interviews);
router.get('/offers', recruitmentController.offers);

module.exports = router;
