const { ForbiddenError } = require('../utils/errors');
const { extractApiKey } = require('./apiKey.middleware');

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Audit finding H-08: this app's real deployment topology has the frontend
 * and backend on different origins, which makes SameSite=None the effective
 * cookie mode — the browser still attaches session cookies to a plain
 * cross-site HTML form POST, and CORS never even runs for that request
 * since a vanilla <form> submission never goes through fetch/XHR.
 *
 * Requiring a custom header on every state-changing request closes that
 * gap cheaply: a raw HTML form can't set custom headers, so this forces the
 * request through fetch/XHR, which in turn forces a CORS preflight — and
 * the existing strict origin allowlist (config/database.js) then actually
 * gets a chance to reject a forged cross-site request before it ever
 * reaches a route handler.
 *
 * GET/HEAD/OPTIONS are read-only and exempt. The /iclock/* device routes
 * are mounted (and fully handled) before this middleware in app.js, so they
 * never reach it regardless.
 *
 * Second-pass audit finding H-08 (regression): this middleware runs before
 * `authenticate`, so req.user/req.apiKey aren't set yet — but any request
 * that already carries an API-key-shaped credential (extractApiKey, the
 * same X-API-Key / Bearer hrms_… detection requireApiScope's auth path
 * uses elsewhere) is exempted from the header check entirely. CSRF is a
 * browser-session attack: it relies on the victim's browser implicitly
 * attaching a cookie the attacker never sees. An API key is an explicit
 * credential the caller must already possess and deliberately send — a
 * forged cross-site request can no more set a valid X-API-Key header than
 * it can set X-Requested-With, so there's nothing for this check to
 * protect against on that path. Whether the key is actually VALID is still
 * fully enforced downstream by authenticateApiKey/requireApiScope as
 * before; this only decides whether the CSRF header is additionally
 * required, never grants access on its own.
 */
const requireCsrfHeader = (req, res, next) => {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();
  if (extractApiKey(req)) return next();
  // Section D2: same reasoning as the API-key exemption above — a beacon
  // ping carries an explicit X-Beacon-Secret credential a forged cross-site
  // request could never set, and it never uses cookies at all. It's also
  // sent by a non-browser device-push app that has no reason to send
  // X-Requested-With. Presence of the header is enough to exempt it here;
  // whether the secret is actually VALID is still fully verified downstream
  // by ipBeacon.service.js's verifyBeaconAuth — this only decides whether
  // the CSRF header is additionally required, never grants access.
  if (req.headers['x-beacon-secret']) return next();
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return next(new ForbiddenError('Missing required request header'));
  }
  next();
};

module.exports = { requireCsrfHeader };
