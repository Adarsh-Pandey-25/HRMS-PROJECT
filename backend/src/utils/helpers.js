const moment = require('moment-timezone');
const { TIMEZONE, WORK_HOURS } = require('./constants');

/** Never send these fields to the client (including nested objects/arrays). */
const SENSITIVE_RESPONSE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'temp_password',
  'tempPassword',
  'current_password',
  'currentPassword',
  'new_password',
  'newPassword',
  'refresh_token',
  'refreshToken',
  'token_hash',
  'tokenHash',
  'smtp_password',
  'smtpPassword',
  'api_key',
  'apiKey',
  'key_hash',
  'keyHash',
  'secret',
  'private_key',
  'privateKey',
]);
// Note: plaintextKey is intentionally NOT listed — returned once on API key create.

const sanitizeForClient = (value) => {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(sanitizeForClient);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_RESPONSE_KEYS.has(key)) continue;
    out[key] = sanitizeForClient(val);
  }
  return out;
};

const successResponse = (res, message, data = null, meta = null, statusCode = 200) => {
  const response = {
    success: true,
    message,
    data: sanitizeForClient(data),
    timestamp: new Date().toISOString(),
  };
  if (meta) response.meta = meta;
  return res.status(statusCode).json(response);
};

const errorResponse = (res, code, message, details = null, statusCode = 400) => {
  return res.status(statusCode).json({
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  });
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
};

const normalizeIp = (ip) => {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
  return ip;
};

const ipInCidr = (ip, cidr) => {
  if (!cidr) return false;
  const normalizedIp = normalizeIp(ip);
  // Support comma/semicolon-separated whitelist from Settings → Attendance
  const ranges = String(cidr)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ranges.length) return false;

  const ipToNum = (addr) =>
    addr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;

  return ranges.some((entry) => {
    if (!entry.includes('/')) {
      return normalizedIp === normalizeIp(entry);
    }
    const [range, bits] = entry.split('/');
    const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
    try {
      return (ipToNum(normalizedIp) & mask) === (ipToNum(range) & mask);
    } catch {
      return false;
    }
  });
};

const nowIST = () => moment().tz(TIMEZONE);

const toIST = (date) => moment(date).tz(TIMEZONE);

const calculateWorkingHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;
  const diffMs = moment(checkOut).diff(moment(checkIn));
  return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
};

const determineAttendanceStatus = (checkIn, totalHours, isLateThreshold = 30) => {
  const checkInMoment = moment(checkIn).tz(TIMEZONE);
  const standardStart = checkInMoment.clone().hour(9).minute(30).second(0);
  const isLate = checkInMoment.isAfter(standardStart.add(isLateThreshold, 'minutes'));

  if (totalHours < WORK_HOURS / 2) return 'half_day';
  if (totalHours < WORK_HOURS) return 'early_departure';
  if (isLate) return 'late';
  return 'present';
};

const calculateLeaveDays = (fromDate, toDate, isHalfDay = false) => {
  if (isHalfDay) return 0.5;
  const from = moment(fromDate);
  const to = moment(toDate);
  return to.diff(from, 'days') + 1;
};

const paginate = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const buildMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

const DEFAULT_OMIT_FIELDS = [
  'password',
  'password_hash',
  'passwordHash',
  'temp_password',
  'tempPassword',
  'token_hash',
  'tokenHash',
];

const omitSensitive = (obj, fields = DEFAULT_OMIT_FIELDS) => {
  if (!obj) return obj;
  const result = { ...obj };
  fields.forEach((f) => delete result[f]);
  return result;
};

/** @deprecated Prefer allocateNextEmployeeCode(companyId). Do not use random codes. */
const generateEmployeeCode = () => {
  // Legacy helper — not used for real creates. Format matches EMP001 style for display only.
  return 'EMP001';
};

/** Default login password: {FirstName}{LastName}@123 (each name part title-cased, no spaces). */
const generateDefaultPassword = (firstName = '', lastName = '') => {
  const titleCaseParts = (str) => {
    if (!str) return '';
    return String(str)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  };
  return `${titleCaseParts(firstName)}${titleCaseParts(lastName)}@123`;
};

module.exports = {
  successResponse,
  errorResponse,
  getClientIp,
  normalizeIp,
  ipInCidr,
  nowIST,
  toIST,
  calculateWorkingHours,
  determineAttendanceStatus,
  calculateLeaveDays,
  paginate,
  buildMeta,
  omitSensitive,
  sanitizeForClient,
  generateEmployeeCode,
  generateDefaultPassword,
};
