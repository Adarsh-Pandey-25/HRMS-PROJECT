const express = require('express');
const { body, param } = require('express-validator');
const ipBeaconController = require('../controllers/ipBeacon.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate, isHROrAdmin);
// Set up under Settings → Attendance Config: needs Settings → Manage and
// Attendance Tracking → Manage in Settings → User & Role Management.
router.use(requirePermission('settings', 'manage'), requirePermission('attendance', 'manage'));
router.use(requireFeature('ip_based_web'));

router.get('/', ipBeaconController.list);
router.post('/', body('label').trim().notEmpty(), body('expected_region').optional().trim(), validate, ipBeaconController.create);
router.post('/:id/revoke', param('id').isUUID(), validate, ipBeaconController.revoke);

router.get('/pending-approvals', ipBeaconController.listPending);
router.post(
  '/pending-approvals/:id/resolve',
  param('id').isUUID(),
  body('decision').isIn(['approved', 'rejected']),
  validate,
  ipBeaconController.resolvePending,
);

module.exports = router;
