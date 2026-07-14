const express = require('express');
const settingsController = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);
router.use(isHROrAdmin);

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

