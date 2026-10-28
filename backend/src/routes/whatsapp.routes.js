const express = require('express');
const whatsappController = require('../controllers/whatsapp.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isEmployee, isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);
router.use(isEmployee);

// The signed-in person's own WhatsApp updates.
router.get('/me', whatsappController.getMine);
router.post('/me/link', whatsappController.startLink);
router.put('/me/groups', whatsappController.updateMyGroups);
router.delete('/me/link', whatsappController.disconnect);

// The company-wide switch and groups (HR and admins).
router.get('/company', isHROrAdmin, whatsappController.getCompany);
router.put('/company', isHROrAdmin, whatsappController.updateCompany);

module.exports = router;
