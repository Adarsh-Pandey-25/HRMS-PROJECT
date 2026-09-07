const express = require('express');
const reportsController = require('../controllers/reports.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('advanced_reports'));

// Manager-and-above module — plain Employees have their own personal attendance/leave
// views elsewhere and never get access to these company/team rollups.
router.get('/team-performance', isManagerOrAbove, reportsController.teamPerformance);
router.get('/attendance-summary', isManagerOrAbove, reportsController.attendanceSummary);
// Item 7: payroll data specifically also needs the payroll feature, on top
// of this whole module's existing advanced_reports gate.
router.get('/payroll-summary', isManagerOrAbove, requireFeature('payroll'), reportsController.payrollSummary);
router.get('/leave-summary', isManagerOrAbove, reportsController.leaveSummary);

module.exports = router;

