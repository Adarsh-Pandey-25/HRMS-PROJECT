const rateLimit = require('express-rate-limit');
const config = require('../config/database');

/** Never trust an unverified JWT for limiter keys. Bind auth attempts to IP + email. */
const authKeyGenerator = (req) => {
  const email = req.body?.email
    ? String(req.body.email).toLowerCase().trim()
    : 'none';
  return `ip:${req.ip}:email:${email}`;
};

const ipKeyGenerator = (req) => `ip:${req.ip}`;

const limiterOptions = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: true,
  legacyHeaders: false,
};

const generalLimiter = rateLimit({
  ...limiterOptions,
  max: config.rateLimit.max,
  keyGenerator: ipKeyGenerator,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
    timestamp: new Date().toISOString(),
  },
});

const authLimiter = rateLimit({
  ...limiterOptions,
  max: config.rateLimit.authMax,
  keyGenerator: authKeyGenerator,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many auth attempts, please try again later' },
    timestamp: new Date().toISOString(),
  },
});

const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  max: config.rateLimit.bootstrapMax,
  keyGenerator: ipKeyGenerator,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many workspace setup attempts' },
    timestamp: new Date().toISOString(),
  },
});

/** OTP send/verify during onboarding — higher allowance than final Launch. */
const onboardingOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  max: config.rateLimit.onboardingOtpMax,
  keyGenerator: authKeyGenerator,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many OTP attempts. Please try again later.' },
    timestamp: new Date().toISOString(),
  },
});

/** Device push endpoints are unauthenticated by protocol — gate by IP since there's no other identity to key on. */
const admsLimiter = rateLimit({
  ...limiterOptions,
  max: config.rateLimit.admsMax,
  keyGenerator: ipKeyGenerator,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
    timestamp: new Date().toISOString(),
  },
});

module.exports = {
  generalLimiter, authLimiter, bootstrapLimiter, onboardingOtpLimiter, admsLimiter,
};
