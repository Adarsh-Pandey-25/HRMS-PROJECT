const express = require('express');
const settingsController = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission, requireAnyPermission } = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate);

// Every authenticated user needs the matrix to authorize UI / routes
router.get('/role_permissions', settingsController.getRolePermissions);
router.get('/company-profile', settingsController.getCompanyProfile);

router.use(isHROrAdmin);

// Changing settings: Settings → User & Role Management → Settings → Manage.
// Reading them doesn't need it — other HR screens read company settings.
// Shifts (Attendance → Manage) save attendance_config through PUT /:key too.
const manageSettings = requirePermission('settings', 'manage');
const manageSettingsOrShifts = requireAnyPermission([['settings', 'manage'], ['attendance', 'manage']]);
const canSaveSetting = (req, res, next) => (
  req.params.key === 'attendance_config' ? manageSettingsOrShifts : manageSettings)(req, res, next);

router.post('/company-logo', manageSettings, upload.single('logo'), settingsController.uploadCompanyLogo);
router.post('/company-brand-icon', manageSettings, upload.single('icon'), settingsController.uploadCompanyBrandIcon);
router.get('/', settingsController.getAll);
// Item 7: payroll settings are part of the payroll module gate too.
router.get('/payroll-components', requireFeature('payroll'), settingsController.getPayrollComponents);
router.post('/payroll-components', manageSettings, requireFeature('payroll'), settingsController.createPayrollComponent);
router.put('/payroll-components/:id', manageSettings, requireFeature('payroll'), settingsController.updatePayrollComponent);
router.delete('/payroll-components/:id', manageSettings, requireFeature('payroll'), settingsController.deletePayrollComponent);
router.get('/leave-allocations', settingsController.getLeaveAllocations);
router.put('/leave-allocations', manageSettings, settingsController.updateLeaveAllocations);
router.post('/leave-allocations/apply', manageSettings, settingsController.applyLeaveAllocationsToAll);
router.get('/leave-policy', settingsController.getLeavePolicy);
router.put('/leave-policy', manageSettings, settingsController.updateLeavePolicy);
router.post('/leave-policy/apply', manageSettings, settingsController.applyLeavePolicyToAll);
router.post('/backup/run', manageSettings, settingsController.runBackupNow);
router.get('/backup/status', settingsController.getBackupStatus);
router.get('/:key', settingsController.getByKey);
router.put('/:key', canSaveSetting, settingsController.updateKey);

module.exports = router;

