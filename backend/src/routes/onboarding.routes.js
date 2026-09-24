const express = require('express');
const { authenticateOnboarding } = require('../middleware/authenticateOnboarding.middleware');
const { validate } = require('../middleware/validation.middleware');
const { upload } = require('../middleware/upload.middleware');
const onboardingController = require('../controllers/onboarding.controller');

const router = express.Router();

// GET /api/onboarding/me — return current employee data for pre-fill
router.get('/me', authenticateOnboarding, onboardingController.getMe);

// PUT /api/onboarding/complete — fill profile + set password
router.put('/complete', authenticateOnboarding, onboardingController.complete);

// POST /api/onboarding/upload-photo — upload profile picture
router.post('/upload-photo', authenticateOnboarding, upload.single('photo'), onboardingController.uploadPhoto);

module.exports = router;
