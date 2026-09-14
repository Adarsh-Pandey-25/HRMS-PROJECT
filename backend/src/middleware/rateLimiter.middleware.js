const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
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

/**
 * Global rate limiter — per-user when authenticated, per-device when not.
 * Uses jwt.decode() (no verification) only to read the user ID claim for
 * bucket selection; actual auth still runs later via the authenticate
 * middleware. This means:
 * - Logged-in employees on the same WiFi get independent buckets (no NAT
 * collisions — the original problem with IP-only keying).
 * - Unauthenticated traffic (public pages, health checks) keys on IP +
 * User-Agent so different devices on the same network don't share a
 * bucket.
 * - A forged/malformed token just gets its own synthetic bucket — no worse
 * than IP-keying, and the auth layer still rejects it downstream.
 */
const generalKeyGenerator = (req) => {
 const token =
 req.cookies?.accessToken ||
 (req.headers.authorization?.startsWith('Bearer ')
 ? req.headers.authorization.split(' ')[1]
 : null);

 if (token) {
 try {
 const decoded = jwt.decode(token);
 if (decoded?.id) return `user:${decoded.id}`;
 } catch {
 // malformed token — fall through to anon key
 }
 }

 const ua = String(req.get('user-agent') || 'unknown').slice(0, 80);
 return `anon:${req.ip}:${ua}`;
};

const generalLimiter = rateLimit({
 ...limiterOptions,
 max: config.rateLimit.max,
 keyGenerator: generalKeyGenerator,
 message: {
 success: false,
 error: { code: 'RATE_LIMIT', message: 'Too many requests, please try again later' },
 timestamp: new Date().toISOString(),
 },
});

/**
 * Settings changes are infrequent and company-wide in impact — tighten the
 * budget to 5 per minute per authenticated user. Reads the raw JWT from
 * cookies/headers (same as generalKeyGenerator) because the authenticate
 * middleware runs downstream, inside each route router, after the limiter.
 */
const settingsKeyGenerator = (req) => {
 const token =
 req.cookies?.accessToken ||
 (req.headers.authorization?.startsWith('Bearer ')
 ? req.headers.authorization.split(' ')[1]
 : null);

 if (token) {
 try {
 const decoded = jwt.decode(token);
 if (decoded?.id) return `settings:${decoded.id}`;
 } catch {
 // malformed token — fall through to IP
 }
 }

 return `settings:${req.ip}`;
};

const settingsLimiter = rateLimit({
 ...limiterOptions,
 max: config.rateLimit.settingsMax,
 keyGenerator: settingsKeyGenerator,
 message: {
 success: false,
 error: { code: 'RATE_LIMIT', message: 'Too many settings changes — please slow down' },
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

/**
 * Device push endpoints are unauthenticated by protocol — key on the device
 * serial (SN query param) so each registered biometric device gets its own
 * independent rate budget. This is correct because:
 * - Devices behind the same NAT (shared public IP) don't starve each other
 * - Different companies' devices never share a bucket even on the same IP
 * - The serial is validated by assertDeviceAuthorized upstream; unknown
 * serials get rejected (403) before any punch is written, so fake-SN
 * probes can only burn their own MemoryStore entry, which auto-expires.
 */
const admsLimiter = rateLimit({
 ...limiterOptions,
 max: config.rateLimit.admsMax,
 keyGenerator: (req) => `adms:${req.query.SN || 'unknown'}`,
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
 windowMs: (parseInt(process.env.WEBHOOK_TEST_RATE_LIMIT_WINDOW, 10) || 5) * 60 * 1000,
 standardHeaders: true,
 legacyHeaders: false,
 max: config.rateLimit.webhookTestMax,
 keyGenerator: (req) => `webhook-test:${req.params.id || 'unknown'}`,
 message: {
 success: false,
 error: { code: 'RATE_LIMIT', message: 'Too many test events for this webhook — try again in a few minutes.' },
 timestamp: new Date().toISOString(),
 },
});

module.exports = {
 generalLimiter, authLimiter, bootstrapLimiter, onboardingOtpLimiter, settingsLimiter, admsLimiter, beaconPingLimiter,
 webhookTestLimiter,
};
