const express = require('express');
const announcementController = require('../controllers/announcement.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validation.middleware');
const { announcementRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/create', isHROrAdmin, upload.single('attachment'), announcementRules, validate, announcementController.create);
router.get('/all', isHROrAdmin, paginationQuery, validate, announcementController.all);
router.get('/active', isEmployee, announcementController.active);
router.put('/:id/update', isHROrAdmin, uuidParam(), validate, announcementController.update);
router.delete('/:id', isHROrAdmin, uuidParam(), validate, announcementController.remove);
router.post('/:id/acknowledge', isEmployee, uuidParam(), validate, announcementController.acknowledge);

module.exports = router;
