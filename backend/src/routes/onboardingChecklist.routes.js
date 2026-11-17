const express = require('express');
const onboardingChecklistController = require('../controllers/onboardingChecklist.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { uuidParam } = require('../utils/validators');
const { requirePermission } = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate, isHROrAdmin);

// Changing the templates (Settings → Onboarding Checklist) needs Settings →
// Manage; reading them doesn't, as with other settings.
const manageSettings = requirePermission('settings', 'manage');

router.get('/', onboardingChecklistController.list);
router.post('/', manageSettings, onboardingChecklistController.create);
router.patch('/:id', manageSettings, uuidParam(), validate, onboardingChecklistController.update);
router.delete('/:id', manageSettings, uuidParam(), validate, onboardingChecklistController.remove);

module.exports = router;
