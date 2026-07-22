const express = require('express');
const settingsController = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');

const router = express.Router();

router.use(authenticate);

// Every authenticated user needs the matrix to authorize UI / routes
router.get('/role_permissions', settingsController.getRolePermissions);
router.get('/company-profile', settingsController.getCompanyProfile);

router.use(isHROrAdmin);

router.post('/company-logo', upload.single('logo'), settingsController.uploadCompanyLogo);
router.get('/', settingsController.getAll);
router.get('/payroll-components', settingsController.getPayrollComponents);
router.post('/payroll-components', settingsController.createPayrollComponent);
router.put('/payroll-components/:id', settingsController.updatePayrollComponent);
router.delete('/payroll-components/:id', settingsController.deletePayrollComponent);
router.get('/leave-allocations', settingsController.getLeaveAllocations);
router.put('/leave-allocations', settingsController.updateLeaveAllocations);
router.post('/leave-allocations/apply', settingsController.applyLeaveAllocationsToAll);
router.get('/leave-policy', settingsController.getLeavePolicy);
router.put('/leave-policy', settingsController.updateLeavePolicy);
router.post('/leave-policy/apply', settingsController.applyLeavePolicyToAll);
router.get('/:key', settingsController.getByKey);
router.put('/:key', settingsController.updateKey);

module.exports = router;

