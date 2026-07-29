const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const apiKeyService = require('../services/apiKey.service');

/** Extract raw API key from X-API-Key or Authorization: Bearer hrms_… */
const extractApiKey = (req) => {
  const headerKey = req.headers['x-api-key'];
  if (headerKey && typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.startsWith('hrms_live_') || token.startsWith('hrms_test_')) {
      return token;
    }
  }
  return null;
};

/**
 * Attach a synthetic req.user from a verified API key (company-scoped).
 * Role is `api_key` so JWT role guards (isEmployee, isHROrAdmin, …) reject it
 * unless a route explicitly allows API keys via requireApiScope.
 */
const attachApiKeyUser = (req, keyRow) => {
  req.apiKey = keyRow;
  req.user = {
    id: null,
    email: null,
    role: 'api_key',
    company_id: keyRow.company_id,
    is_api_key: true,
    api_key_id: keyRow.id,
    scopes: keyRow.scopes || [],
    first_name: 'API',
    last_name: 'Key',
  };
  req.authType = 'api_key';
};

/** Require a verified API key (no JWT). */
const authenticateApiKey = async (req, res, next) => {
  try {
    const raw = extractApiKey(req);
    if (!raw) throw new UnauthorizedError('API key required (X-API-Key or Bearer hrms_…)');

    const keyRow = await apiKeyService.verifyApiKey(raw);
    if (!keyRow) throw new UnauthorizedError('Invalid or revoked API key');

    attachApiKeyUser(req, keyRow);
    next();
  } catch (err) {
    next(err);
  }
};

/** Require one of the listed scopes on an API-key authenticated request. */
const requireApiScope = (...needed) => (req, res, next) => {
  if (!req.user?.is_api_key) {
    return next(new ForbiddenError('API key authentication required'));
  }
  const ok = needed.some((scope) => apiKeyService.hasScope(req.user, scope));
  if (!ok) {
    return next(new ForbiddenError(`API key missing required scope: ${needed.join(' or ')}`));
  }
  next();
};

/**
 * Allow JWT users OR API keys with any of the given scopes.
 * Use on machine-facing routes (e.g. biometric webhook).
 */
const allowJwtOrApiScope = (...scopes) => (req, res, next) => {
  if (req.user?.is_api_key) {
    const ok = scopes.some((s) => apiKeyService.hasScope(req.user, s));
    if (!ok) {
      return next(new ForbiddenError(`API key missing required scope: ${scopes.join(' or ')}`));
    }
    return next();
  }
  if (req.user) return next();
  return next(new UnauthorizedError('Authentication required'));
};

module.exports = {
  extractApiKey,
  attachApiKeyUser,
  authenticateApiKey,
  requireApiScope,
  allowJwtOrApiScope,
};
