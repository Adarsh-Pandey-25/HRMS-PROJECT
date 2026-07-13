const express = require('express');
const helpdeskController = require('../controllers/helpdesk.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/tickets', isHROrAdmin, helpdeskController.tickets);
router.get('/my-tickets', helpdeskController.myTickets);
router.post('/tickets', helpdeskController.create);
router.put('/tickets/:id/status', isHROrAdmin, helpdeskController.updateStatus);
router.post('/tickets/:id/comments', helpdeskController.comment);
router.get('/kb/categories', helpdeskController.kbCategories);
router.get('/kb/articles', helpdeskController.kbArticles);

module.exports = router;
