const express = require('express');
const auditLogController = require('../controllers/auditLog.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { paginationQuery } = require('../utils/validators');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);
router.get('/', paginationQuery, validate, auditLogController.list);

module.exports = router;
