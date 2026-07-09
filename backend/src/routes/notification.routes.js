const express = require('express');
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(isEmployee);

router.get('/', paginationQuery, validate, notificationController.myNotifications);
router.get('/unread-count', notificationController.unreadCount);
router.put('/:id/read', uuidParam(), validate, notificationController.markAsRead);
router.put('/read-all', notificationController.markAllAsRead);

module.exports = router;

