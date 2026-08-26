const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Endpoints reachable with NO authentication at all. A raw Postgres/Supabase error
 * message leaking here is reachable by literally anyone on the internet, unlike the
 * ~177 other call sites across the app that pass a typed (400-range) error straight
 * through with the DB's raw `.message` — those all require a logged-in session first,
 * which is lower severity. This list intentionally stays narrow (see audit finding
 * on error-message hygiene) rather than rewriting error handling app-wide.
 */
const UNAUTHENTICATED_PATHS = new Set([
  '/api/auth/bootstrap-admin',
]);

/** Recognizable raw Postgres/Supabase error phrasing that should never reach a client. */
const RAW_DB_ERROR_PATTERNS = [
  /duplicate key value violates/i,
  /violates foreign key constraint/i,
  /violates unique constraint/i,
  /violates not-null constraint/i,
  /violates check constraint/i,
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /invalid input syntax for/i,
  /permission denied for/i,
];

const looksLikeRawDbError = (message) => {
  const text = String(message || '');
  return RAW_DB_ERROR_PATTERNS.some((re) => re.test(text));
};

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
  }

  // A raw DB error on a 400-range response is not masked by the generic 500 handling
  // below. On endpoints reachable with no auth at all, close that leak specifically.
  if (statusCode < 500 && UNAUTHENTICATED_PATHS.has(req.path) && looksLikeRawDbError(message)) {
    logger.warn('Masked raw DB error on unauthenticated endpoint', {
      path: req.path,
      original: message,
    });
    message = 'We could not process your request. Please check your details and try again.';
    details = null;
  }

  if (statusCode >= 500) {
    logger.error('Server error', {
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      path: req.path,
      method: req.method,
    });
    message = 'Internal server error';
    details = null;
    code = 'INTERNAL_ERROR';
  } else {
    logger.warn('Client error', { code, message, path: req.path });
  }

  res.status(statusCode).json({
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
    timestamp: new Date().toISOString(),
  });
};

module.exports = { errorHandler, notFoundHandler };
