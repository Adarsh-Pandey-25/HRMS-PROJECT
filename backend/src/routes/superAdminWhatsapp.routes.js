const express = require('express');
const superAdminWhatsappController = require('../controllers/superAdminWhatsapp.controller');
const { authenticateSuperAdmin, requireSuperAdminRole } = require('../middleware/superAdmin.middleware');

// Super Admin → WhatsApp. full_admin only: it shows (masked) recipients
// across every company and can pause sending or submit templates to Meta.
const router = express.Router();

router.use(authenticateSuperAdmin);
router.use(requireSuperAdminRole());

router.get('/overview', superAdminWhatsappController.overview);
router.get('/messages', superAdminWhatsappController.messages);
router.put('/pause', superAdminWhatsappController.setPaused);
router.get('/templates', superAdminWhatsappController.templates);
router.post('/templates/sync', superAdminWhatsappController.syncTemplates);
router.post('/test-message', superAdminWhatsappController.testMessage);

router.get('/me', superAdminWhatsappController.getMine);
router.post('/me/link', superAdminWhatsappController.startLink);
router.put('/me/groups', superAdminWhatsappController.updateMyGroups);
router.delete('/me/link', superAdminWhatsappController.disconnect);

module.exports = router;
