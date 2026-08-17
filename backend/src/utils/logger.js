const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

const SENSITIVE_KEY = /password|token|secret|otp|authorization|api[_-]?key|cookie/i;

const redactDeep = (obj, depth = 0) => {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEY.test(k)) {
      obj[k] = '[redacted]';
    } else if (obj[k] && typeof obj[k] === 'object') {
      redactDeep(obj[k], depth + 1);
    }
  }
};

const redactMeta = winston.format((info) => {
  redactDeep(info);
  if (info.stack && process.env.NODE_ENV === 'production') delete info.stack;
  return info;
});

const dailyRotateTransport = new DailyRotateFile({
  filename: path.join(logDir, 'hrms-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m',
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    redactMeta(),
    winston.format.json()
  ),
  defaultMeta: { service: 'hrms-backend' },
  transports: [
    dailyRotateTransport,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const safe = { ...meta };
          delete safe.service;
          if (safe.stack && process.env.NODE_ENV === 'production') delete safe.stack;
          for (const k of Object.keys(safe)) {
            if (SENSITIVE_KEY.test(k)) safe[k] = '[redacted]';
          }
          const metaStr = Object.keys(safe).length ? JSON.stringify(safe) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
