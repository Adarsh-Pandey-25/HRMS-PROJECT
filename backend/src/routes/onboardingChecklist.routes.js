const express = require('express');
const onboardingChecklistController = require('../controllers/onboardingChecklist.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);

router.get('/', onboardingChecklistController.list);
router.post('/', onboardingChecklistController.create);
router.patch('/:id', onboardingChecklistController.update);
router.delete('/:id', onboardingChecklistController.remove);

module.exports = router;
