const rateLimit = require('express-rate-limit');
const config = require('../config/database');

/* TODO: Replace with a Redis-backed store (e.g. rate-limit-redis) before
   horizontal scaling — every limiter below uses express-rate-limit's default
   in-memory MemoryStore, which resets on every deploy/restart and is not
   shared across instances. At a single instance (today) this is harmless;
   the moment this backend runs on more than one instance, each instance
   enforces its own independent counter, effectively multiplying the real
   rate limit by the instance count. See audit finding L-10. */

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

/**
 * Section D2: "max once per 30 seconds per beacon" — keyed on the beacon_key
 * in the URL, not IP. A beacon legitimately pushes from whatever IP it's
 * currently on (that's the whole point), and different beacons must never
 * share a rate bucket just because they happen to push from the same
 * office network.
 */
const beaconPingLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `beacon:${req.params.beaconKey || 'unknown'}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Beacon pings are limited to once every 30 seconds.' },
    timestamp: new Date().toISOString(),
  },
});

/**
 * Security audit finding: "Send Test Event" triggers a real outbound HTTP
 * request to an admin-supplied URL and previously relied only on the global
 * 100/min limiter — generous enough to use as an SSRF-probing or DoS tool
 * against whatever URL is configured. Keyed per-webhook (not IP): different
 * admins at the same company sharing an IP shouldn't share a bucket, and a
 * company shouldn't be able to reset its budget by testing a different
 * webhook id. 5 per 5 minutes is generous for genuine debugging, tight
 * enough to kill repeated-probing value.
 */
const webhookTestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `webhook-test:${req.params.id || 'unknown'}`,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many test events for this webhook — try again in a few minutes.' },
    timestamp: new Date().toISOString(),
  },
});

module.exports = {
  generalLimiter, authLimiter, bootstrapLimiter, onboardingOtpLimiter, admsLimiter, beaconPingLimiter,
  webhookTestLimiter,
};
