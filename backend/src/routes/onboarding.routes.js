const express = require('express');
const { body } = require('express-validator');
const { authenticateOnboarding } = require('../middleware/authenticateOnboarding.middleware');
const { validate } = require('../middleware/validation.middleware');
const { upload } = require('../middleware/upload.middleware');
const { authLimiter } = require('../middleware/rateLimiter.middleware');
const onboardingController = require('../controllers/onboarding.controller');
const { GENDERS } = require('../utils/constants');

const router = express.Router();

const completeRules = [
  body('password').isString().isLength({ min: 8, max: 1024 }),
  body('phone_number').optional({ values: 'falsy' }).isString().trim()
    .matches(/^\+?[0-9 ()-]{7,20}$/).withMessage('Enter a valid phone number'),
  body('date_of_birth').optional({ values: 'falsy' }).isISO8601().withMessage('Enter a valid date of birth'),
  body('gender').optional({ values: 'falsy' }).isIn(GENDERS),
  body('address').optional().isObject(),
  body('address.street').optional().isString().isLength({ max: 300 }),
  body('address.city').optional().isString().isLength({ max: 100 }),
  body('address.state').optional().isString().isLength({ max: 100 }),
  body('address.pincode').optional({ values: 'falsy' }).isString().matches(/^[0-9]{6}$/).withMessage('Pincode must be 6 digits'),
  body('emergency_contact').optional().isObject(),
  body('emergency_contact.name').optional().isString().isLength({ max: 200 }),
  body('emergency_contact.phone').optional({ values: 'falsy' }).isString()
    .matches(/^\+?[0-9 ()-]{7,20}$/).withMessage('Enter a valid emergency contact number'),
  body('bank_details').optional().isObject(),
  body('bank_details.bank_name').optional().isString().isLength({ max: 150 }),
  body('bank_details.account_holder_name').optional().isString().isLength({ max: 200 }),
  body('bank_details.account_number').optional({ values: 'falsy' }).isString()
    .matches(/^[0-9]{6,20}$/).withMessage('Account number must be 6–20 digits'),
  body('bank_details.ifsc_code').optional({ values: 'falsy' }).isString()
    .matches(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/).withMessage('Enter a valid IFSC code'),
];

// GET /api/onboarding/me — current employee data for pre-fill
router.get('/me', authenticateOnboarding, onboardingController.getMe);

// PUT /api/onboarding/complete — fill profile + set password
router.put('/complete', authLimiter, authenticateOnboarding, completeRules, validate, onboardingController.complete);

// POST /api/onboarding/upload-photo — upload profile picture
router.post('/upload-photo', authenticateOnboarding, upload.single('photo'), onboardingController.uploadPhoto);

module.exports = router;
