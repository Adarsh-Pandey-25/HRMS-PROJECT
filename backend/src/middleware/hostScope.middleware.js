const { AppError } = require('../utils/errors');
const { extractApiKey } = require('./apiKey.middleware');

/**
 * Enforces the apex-vs-tenant split on the API, using req.hostKind set by
 * tenantSubdomain.middleware.js (must run after it).
 *
 * - apex (spaxsync.com / www / api): platform surface only — public
 *   marketing API, super-admin, and company onboarding from an invite.
 * - tenant ({slug}.spaxsync.com, resolved): the company app. Platform-only
 *   endpoints are hidden.
 * - unknown-tenant: a subdomain with no company behind it — nothing works.
 * - other (BASE_DOMAIN unset, localhost, previews): unrestricted.
 *
 * Biometric device push (/iclock) and API-key calls identify themselves by
 * device serial / key, not by host, so they pass on any host.
 */

const APEX_ALLOWED_PREFIXES = [
  '/api/public/',
  '/api/super-admin/',
  '/api/auth/onboarding/',
];
const APEX_ALLOWED_EXACT = new Set(['/api/auth/bootstrap-admin']);

const PLATFORM_ONLY_PREFIXES = ['/api/super-admin/', '/api/auth/onboarding/'];
const PLATFORM_ONLY_EXACT = new Set(['/api/auth/bootstrap-admin']);

const startsWithAny = (path, prefixes) => prefixes.some((p) => path.startsWith(p));

const notFound = (code) => new AppError('Not found', 404, code);

const hostScope = (req, res, next) => {
  const kind = req.hostKind;
  if (!kind || kind === 'other') return next();

  // Normalise a trailing slash so '/api/public' and '/api/public/' match alike.
  const path = req.path.endsWith('/') ? req.path : `${req.path}/`;
  const exactPath = req.path.replace(/\/+$/, '');
  if (!path.startsWith('/api/')) return next();
  if (extractApiKey(req)) return next();

  if (kind === 'apex') {
    if (startsWithAny(path, APEX_ALLOWED_PREFIXES) || APEX_ALLOWED_EXACT.has(exactPath)) return next();
    return next(notFound('WORKSPACE_REQUIRED'));
  }

  if (kind === 'tenant') {
    if (startsWithAny(path, PLATFORM_ONLY_PREFIXES) || PLATFORM_ONLY_EXACT.has(exactPath)) {
      return next(notFound('NOT_FOUND'));
    }
    return next();
  }

  // unknown-tenant
  return next(notFound('WORKSPACE_NOT_FOUND'));
};

module.exports = { hostScope };
