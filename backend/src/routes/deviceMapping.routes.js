const express = require('express');
const deviceMappingController = require('../controllers/deviceMapping.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);

router.get('/unmapped', deviceMappingController.unmapped);
router.get('/device-users', deviceMappingController.deviceUsers);
router.get('/', deviceMappingController.list);
router.post('/', deviceMappingController.create);
router.delete('/:deviceUserId', deviceMappingController.remove);

module.exports = router;
