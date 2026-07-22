const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err.details || null;

  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
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
