const express = require('express');
const helpdeskController = require('../controllers/helpdesk.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { uuidParam } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('helpdesk'));

// Settings → User & Role Management → Helpdesk Support → Manage: All Tickets.
// Raising and following your own tickets never needs it.
const manageHelpdesk = requirePermission('helpdesk', 'manage');

router.get('/tickets', isHROrAdmin, manageHelpdesk, helpdeskController.tickets);
router.get('/my-tickets', helpdeskController.myTickets);
router.post('/tickets', helpdeskController.create);
router.put('/tickets/:id/status', isHROrAdmin, manageHelpdesk, uuidParam(), validate, helpdeskController.updateStatus);
router.post('/tickets/:id/comments', uuidParam(), validate, helpdeskController.comment);
router.get('/kb/categories', helpdeskController.kbCategories);
router.get('/kb/articles', helpdeskController.kbArticles);

module.exports = router;
