const express = require('express');
const announcementController = require('../controllers/announcement.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { validate } = require('../middleware/validation.middleware');
const { announcementRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Settings → User & Role Management → Announcements: Create = post one,
// Manage = edit or delete. Reading them never needs more than View.
const can = (action) => requirePermission('announcements', action);

router.post('/create', isHROrAdmin, can('create'), upload.single('attachment'), announcementRules, validate, announcementController.create);
router.get('/all', isHROrAdmin, can('view'), paginationQuery, validate, announcementController.all);
router.get('/active', isEmployee, announcementController.active);
router.get('/:id/attachment', isEmployee, uuidParam(), validate, announcementController.attachment);
router.put('/:id/update', isHROrAdmin, can('manage'), uuidParam(), validate, announcementController.update);
router.delete('/:id', isHROrAdmin, can('manage'), uuidParam(), validate, announcementController.remove);
router.post('/:id/acknowledge', isEmployee, uuidParam(), validate, announcementController.acknowledge);

module.exports = router;
