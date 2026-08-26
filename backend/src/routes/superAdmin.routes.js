const express = require('express');
const { body, param } = require('express-validator');
const superAdminController = require('../controllers/superAdmin.controller');
const { authenticateSuperAdmin } = require('../middleware/superAdmin.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

router.post(
  '/login',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  superAdminController.login,
);

router.post('/logout', authenticateSuperAdmin, superAdminController.logout);
router.post('/refresh-token', authLimiter, superAdminController.refreshToken);
router.get('/me', authenticateSuperAdmin, superAdminController.me);

router.get('/companies', authenticateSuperAdmin, superAdminController.listCompanies);
router.patch(
  '/companies/:id',
  authenticateSuperAdmin,
  param('id').isUUID(),
  body('is_active').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
  validate,
  superAdminController.setCompanyActive,
);

router.get('/invites', authenticateSuperAdmin, superAdminController.listInvites);
router.get('/invites/suggest-slug', authenticateSuperAdmin, superAdminController.suggestSlug);
router.post(
  '/invites',
  authenticateSuperAdmin,
  body('email').isEmail().normalizeEmail(),
  body().custom((payload) => {
    const companyName = payload.company_name_hint || payload.companyNameHint;
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      throw new Error('Company name is required');
    }
    if (companyName.trim().length > 200) {
      throw new Error('Company name must not exceed 200 characters');
    }
    return true;
  }),
  body('expires_in_days').optional().isInt({ min: 1, max: 30 }),
  body('expiresInDays').optional().isInt({ min: 1, max: 30 }),
  body('slug').optional().isString().isLength({ max: 63 }),
  body('company_slug').optional().isString().isLength({ max: 63 }),
  validate,
  superAdminController.createInvite,
);
router.post(
  '/invites/:id/revoke',
  authenticateSuperAdmin,
  param('id').isUUID(),
  validate,
  superAdminController.revokeInvite,
);

module.exports = router;
