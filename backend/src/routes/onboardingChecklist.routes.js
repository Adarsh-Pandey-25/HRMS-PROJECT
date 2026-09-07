const express = require('express');
const onboardingChecklistController = require('../controllers/onboardingChecklist.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { uuidParam } = require('../utils/validators');

const router = express.Router();

router.use(authenticate, isHROrAdmin);

router.get('/', onboardingChecklistController.list);
router.post('/', onboardingChecklistController.create);
router.patch('/:id', uuidParam(), validate, onboardingChecklistController.update);
router.delete('/:id', uuidParam(), validate, onboardingChecklistController.remove);

module.exports = router;
