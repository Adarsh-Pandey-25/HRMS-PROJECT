const express = require('express');
const deviceMappingController = require('../controllers/deviceMapping.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);
// Item 8B: every route here is device-management (claim status, mapping) —
// blanket-gated. Never affects /iclock/* punch ingestion (a separate,
// unauthenticated route file the ADMS protocol itself hits).
router.use(requireFeature('biometric_adms'));

router.get('/unmapped', deviceMappingController.unmapped);
router.get('/device-users', deviceMappingController.deviceUsers);
router.get('/', deviceMappingController.list);
router.post('/', deviceMappingController.create);
router.delete('/:deviceUserId', deviceMappingController.remove);

module.exports = router;
