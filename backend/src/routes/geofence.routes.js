const express = require('express');
const { body, param } = require('express-validator');
const geofenceController = require('../controllers/geofence.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);
// Section E: geofence MANAGEMENT is entitlement-gated the same way as any
// other feature — reuses Module 6's mechanism, not a new one.
router.use(requireFeature('gps_geofence'));

router.get('/', geofenceController.list);
router.post(
  '/',
  body('label').trim().notEmpty(),
  body('center_latitude').isFloat({ min: -90, max: 90 }),
  body('center_longitude').isFloat({ min: -180, max: 180 }),
  body('radius_meters').optional().isInt({ min: 20, max: 2000 }),
  validate,
  geofenceController.create,
);
router.put('/:id', param('id').isUUID(), validate, geofenceController.update);
router.post('/:id/deactivate', param('id').isUUID(), validate, geofenceController.deactivate);

module.exports = router;
