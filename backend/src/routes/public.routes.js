const express = require('express');
const { body } = require('express-validator');
const marketingController = require('../controllers/marketing.controller');
const { validate } = require('../middleware/validation.middleware');
const { publicLeadLimiter } = require('../middleware/rateLimiter.middleware');

/**
 * Unauthenticated endpoints for the apex marketing site. POSTs still go
 * through the global CSRF header check in app.js.
 */
const router = express.Router();

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

const leadRules = [
  body('type').isIn(['trial', 'contact']),
  body('full_name').isString().trim().isLength({ min: 2, max: 200 }),
  body('work_email').isString().trim().isEmail().isLength({ max: 255 }).normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).isString().trim()
    .matches(/^\+?[0-9 ()-]{7,20}$/).withMessage('Enter a valid phone number'),
  body('company_name')
    .if(body('type').equals('trial'))
    .isString().trim().isLength({ min: 2, max: 200 }),
  body('company_name').optional({ values: 'falsy' }).isString().trim().isLength({ max: 200 }),
  body('company_size').optional({ values: 'falsy' }).isIn(COMPANY_SIZES),
  body('desired_slug').optional({ values: 'falsy' }).isString().trim().isLength({ max: 63 }),
  body('message')
    .if(body('type').equals('contact'))
    .isString().trim().isLength({ min: 5, max: 4000 }),
  body('message').optional({ values: 'falsy' }).isString().trim().isLength({ max: 4000 }),
  body('source_path').optional({ values: 'falsy' }).isString().isLength({ max: 200 }),
  // Honeypot — see marketing.controller.js submitLead.
  body('website').optional().isString().isLength({ max: 500 }),
];

router.get('/plans', marketingController.listPlans);
router.post('/leads', publicLeadLimiter, leadRules, validate, marketingController.submitLead);

module.exports = router;
