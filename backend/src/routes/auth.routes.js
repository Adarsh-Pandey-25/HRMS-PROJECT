const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validateOfficeIp } = require('../middleware/ipValidation.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter } = require('../middleware/rateLimiter.middleware');
const {
  registerRules, loginRules, changePasswordRules,
  forgotPasswordRules, resetPasswordRules,
} = require('../utils/validators');

const router = express.Router();

router.post('/register', authenticate, isHROrAdmin, registerRules, validate, authController.register);
router.post('/login', authLimiter, validateOfficeIp, loginRules, validate, authController.login);
router.post('/logout', authenticate, authController.logout);
router.post('/refresh-token', authLimiter, authController.refreshToken);
router.get('/me', authenticate, authController.getMe);
router.put('/change-password', authenticate, changePasswordRules, validate, authController.changePassword);
router.post('/forgot-password', authLimiter, forgotPasswordRules, validate, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordRules, validate, authController.resetPassword);

module.exports = router;
