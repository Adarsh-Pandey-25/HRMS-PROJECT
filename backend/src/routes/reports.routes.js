const express = require('express');
const reportsController = require('../controllers/reports.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isManagerOrAbove } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('advanced_reports'));

// Settings → User & Role Management → Reports → View.
const viewReports = requirePermission('reports', 'view');

// Manager-and-above module — plain Employees have their own personal attendance/leave
// views elsewhere and never get access to these company/team rollups.
router.get('/team-performance', isManagerOrAbove, viewReports, reportsController.teamPerformance);
router.get('/attendance-summary', isManagerOrAbove, viewReports, reportsController.attendanceSummary);
// Item 7: payroll data specifically also needs the payroll feature, on top
// of this whole module's existing advanced_reports gate.
// Everyone's pay: also needs Payroll → Manage, like every payroll screen (audit, 20 Nov 2026).
router.get('/payroll-summary', isManagerOrAbove, viewReports, requirePermission('payroll', 'manage'), requireFeature('payroll'), reportsController.payrollSummary);
router.get('/leave-summary', isManagerOrAbove, viewReports, reportsController.leaveSummary);

module.exports = router;

