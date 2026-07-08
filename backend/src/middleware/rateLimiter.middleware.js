const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const config = require('../config/database');

/** Per-user bucket: JWT user id → email on auth routes → IP fallback */
const keyGenerator = (req) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const decoded = jwt.decode(auth.slice(7));
    if (decoded?.id) return `user:${decoded.id}`;
  }
  if (req.body?.email) return `email:${String(req.body.email).toLowerCase().trim()}`;
  return `ip:${req.ip}`;
};

const limiterOptions = {
  windowMs: config.rateLimit.windowMs,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
};

const generalLimiter = rateLimit({
  ...limiterOptions,
  max: config.rateLimit.max,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
    timestamp: new Date().toISOString(),
  },
});

const authLimiter = rateLimit({
  ...limiterOptions,
  max: config.rateLimit.authMax,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many auth attempts, please try again later' },
    timestamp: new Date().toISOString(),
  },
});

module.exports = { generalLimiter, authLimiter };
