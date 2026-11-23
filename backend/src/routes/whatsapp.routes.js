const express = require('express');
const whatsappController = require('../controllers/whatsapp.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isEmployee, isHROrAdmin } = require('../middleware/role.middleware');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate);
router.use(isEmployee);

// The signed-in person's own WhatsApp updates.
router.get('/me', whatsappController.getMine);
router.post('/me/link', whatsappController.startLink);
router.put('/me/groups', whatsappController.updateMyGroups);
router.delete('/me/link', whatsappController.disconnect);
// Confirm the connected number with a code sent on WhatsApp, so approvals come
// with Approve / Reject buttons (whatsappVerify.service.js; limits are inside).
router.post('/me/confirm/send', whatsappController.sendConfirmCode);
router.post('/me/confirm', whatsappController.confirmNumber);

// The company-wide switch and groups (HR and admins; Settings → Integrations,
// so Settings → Manage in Settings → User & Role Management).
const manageSettings = requirePermission('settings', 'manage');
router.get('/company', isHROrAdmin, manageSettings, whatsappController.getCompany);
router.put('/company', isHROrAdmin, manageSettings, whatsappController.updateCompany);

module.exports = router;
