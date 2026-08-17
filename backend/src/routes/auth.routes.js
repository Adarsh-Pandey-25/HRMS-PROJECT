const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter, bootstrapLimiter, onboardingOtpLimiter } = require('../middleware/rateLimiter.middleware');
const {
  registerRules, loginRules, changePasswordRules,
  forgotPasswordRules, resetPasswordRules, bootstrapRules,
  onboardingSendOtpRules, onboardingVerifyOtpRules,
} = require('../utils/validators');

const router = express.Router();

router.post('/register', authenticate, isHROrAdmin, registerRules, validate, authController.register);
// Login is allowed from any IP — office IP is enforced only on attendance check-in
router.post('/login', authLimiter, loginRules, validate, authController.login);
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
router.post(
  '/bootstrap-admin',
  bootstrapLimiter,
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
