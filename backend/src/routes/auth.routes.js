const express = require('express');
const { body, query } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter, bootstrapLimiter, onboardingOtpLimiter, twoFaLimiter } = require('../middleware/rateLimiter.middleware');
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
  '/onboarding/slug-availability',
  onboardingOtpLimiter,
  query('slug').isString().isLength({ min: 1, max: 63 }),
  query('inviteToken').isString().isLength({ min: 16, max: 128 }),
  validate,
  authController.onboardingSlugAvailability
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
router.patch('/me/install-prompt-seen', authenticate, authController.markInstallPromptSeen);
router.post('/complete-profile', authenticate, authController.completeProfile);
router.post(
  '/impersonation/start',
  authLimiter,
  body('token').isString().isLength({ min: 20, max: 4096 }),
  validate,
  authController.startImpersonationHandoff,
);
router.post('/impersonation/end', authenticate, authController.endImpersonation);
router.put('/change-password', authenticate, changePasswordRules, validate, authController.changePassword);
router.post('/forgot-password', authLimiter, forgotPasswordRules, validate, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordRules, validate, authController.resetPassword);

// ── Employee self-service 2FA (opt-in) ──────────────────────────────────────
// Step 1: after password login — server returns requires2FA=true with a
// short-lived twoFaToken; client redirects to TOTP input screen.
router.post('/2fa/verify-login', authLimiter,
  body('twoFaToken').notEmpty(),
  body('code').isLength({ min: 6, max: 6 }),
  validate,
  authController.verifyTwoFaAndLogin,
);
// Step 2: enroll — requires an existing session
router.post('/2fa/enroll', authenticate, twoFaLimiter, authController.startEmployeeTwoFactor);
// Step 3: confirm enrollment with a valid TOTP code
router.post('/2fa/confirm', authenticate, twoFaLimiter,
  body('code').isLength({ min: 6, max: 6 }),
  validate,
  authController.confirmEmployeeTwoFactor,
);
// Step 4: disable (requires a valid code to prove device possession)
router.post('/2fa/disable', authenticate, twoFaLimiter,
  body('code').isLength({ min: 6, max: 6 }),
  validate,
  authController.disableEmployeeTwoFactor,
);

module.exports = router;
