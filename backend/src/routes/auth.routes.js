const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter, bootstrapLimiter, onboardingOtpLimiter } = require('../middleware/rateLimiter.middleware');
const { optionalLogoUpload } = require('../middleware/upload.middleware');
const { BadRequestError } = require('../utils/errors');
const {
  loginRules, changePasswordRules,
  forgotPasswordRules, resetPasswordRules, bootstrapRules,
  onboardingSendOtpRules, onboardingVerifyOtpRules,
} = require('../utils/validators');

const router = express.Router();

// Login is allowed from any IP — office IP is enforced only on attendance check-in
router.post('/login', authLimiter, loginRules, validate, authController.login);
// Portal-scoped logins for the subdomain-per-tenant Admin/HR/Employee login pages —
// role is enforced server-side per portal, company is scoped from the resolved
// subdomain (req.tenantCompany) when present.
router.post('/admin/login', authLimiter, loginRules, validate, authController.loginAdmin);
router.post('/hr/login', authLimiter, loginRules, validate, authController.loginHr);
router.post('/employee/login', authLimiter, loginRules, validate, authController.loginEmployee);
router.get('/workspace', authController.workspaceInfo);
router.post(
  '/onboarding/send-otp',
  onboardingOtpLimiter,
  onboardingSendOtpRules,
  validate,
  authController.sendOnboardingOtp
);
router.post(
  '/onboarding/verify-otp',
  onboardingOtpLimiter,
  onboardingVerifyOtpRules,
  validate,
  authController.verifyOnboardingOtp
);
router.get(
  '/onboarding/invite/:token',
  onboardingOtpLimiter,
  authController.peekOnboardingInvite
);
const parseBootstrapFields = (req, res, next) => {
  if (typeof req.body?.company_profile === 'string') {
    try {
      req.body.company_profile = JSON.parse(req.body.company_profile);
    } catch {
      return next(new BadRequestError('Invalid company_profile payload'));
    }
  }
  next();
};

router.post(
  '/bootstrap-admin',
  bootstrapLimiter,
  optionalLogoUpload,
  parseBootstrapFields,
  bootstrapRules,
  validate,
  authController.bootstrapAdmin
);
router.post('/logout', authenticate, authController.logout);
router.post('/refresh-token', authLimiter, authController.refreshToken);
router.get('/me', authenticate, authController.getMe);
router.put('/change-password', authenticate, changePasswordRules, validate, authController.changePassword);
router.post('/forgot-password', authLimiter, forgotPasswordRules, validate, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordRules, validate, authController.resetPassword);

module.exports = router;
