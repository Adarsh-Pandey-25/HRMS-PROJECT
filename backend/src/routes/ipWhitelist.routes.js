const express = require('express');
const { body, param } = require('express-validator');
const ipWhitelistController = require('../controllers/ipWhitelist.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);
router.use(requireFeature('ip_based_web'));

router.get('/', ipWhitelistController.list);
router.post('/', body('cidr').trim().notEmpty(), validate, ipWhitelistController.create);
router.delete('/:id', param('id').isUUID(), validate, ipWhitelistController.remove);

module.exports = router;
