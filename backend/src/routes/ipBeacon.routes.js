const express = require('express');
const { body, param } = require('express-validator');
const ipBeaconController = require('../controllers/ipBeacon.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);
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
