const express = require('express');
const reportsController = require('../controllers/reports.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

// Manager-and-above module — plain Employees have their own personal attendance/leave
// views elsewhere and never get access to these company/team rollups.
router.get('/team-performance', isManagerOrAbove, reportsController.teamPerformance);
router.get('/attendance-summary', isManagerOrAbove, reportsController.attendanceSummary);
router.get('/payroll-summary', isManagerOrAbove, reportsController.payrollSummary);
router.get('/leave-summary', isManagerOrAbove, reportsController.leaveSummary);

module.exports = router;

