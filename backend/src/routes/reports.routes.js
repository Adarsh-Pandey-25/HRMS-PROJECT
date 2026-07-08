const express = require('express');
const reportsController = require('../controllers/reports.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

// Manager module
router.get('/team-performance', isManagerOrAbove, reportsController.teamPerformance);

module.exports = router;

