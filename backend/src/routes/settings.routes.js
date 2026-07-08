const express = require('express');
const settingsController = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);
router.use(isAdmin);

router.get('/', settingsController.getAll);
router.get('/:key', settingsController.getByKey);
router.put('/:key', settingsController.updateKey);

module.exports = router;

