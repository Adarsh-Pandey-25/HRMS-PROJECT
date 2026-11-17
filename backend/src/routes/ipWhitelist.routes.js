const express = require('express');
const { body, param } = require('express-validator');
const ipWhitelistController = require('../controllers/ipWhitelist.controller');
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

router.get('/', ipWhitelistController.list);
router.post('/', body('cidr').trim().notEmpty(), validate, ipWhitelistController.create);
router.delete('/:id', param('id').isUUID(), validate, ipWhitelistController.remove);

module.exports = router;
