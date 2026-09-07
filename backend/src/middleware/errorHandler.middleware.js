const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Audit finding M-07: raw Postgres/Supabase error text (column/relation/
 * constraint names) was only masked on a narrow allowlist of unauthenticated
 * paths — every other 400-range throw across ~177 call sites passed the DB's
 * raw `.message` straight through to any authenticated caller, including a
 * plain `employee` role. Masking now applies to every response regardless
 * of auth state; the real message is always still logged server-side below.
 */
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

  // A raw DB error on a 400-range response is not masked by the generic 500
  // handling below — close that leak for every caller, not just unauthenticated
  // ones (see M-07). The real message is always logged, just never returned.
  if (statusCode < 500 && looksLikeRawDbError(message)) {
    logger.warn('Masked raw DB error in API response', {
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
