const moment = require('moment-timezone');
const { TIMEZONE, WORK_HOURS } = require('./constants');

const successResponse = (res, message, data = null, meta = null, statusCode = 200) => {
  const response = {
    success: true,
    message,
    data,
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
  const normalizedIp = normalizeIp(ip);
  if (!cidr.includes('/')) {
    return normalizedIp === cidr;
  }
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  const ipToNum = (addr) =>
    addr.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  return (ipToNum(normalizedIp) & mask) === (ipToNum(range) & mask);
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

const omitSensitive = (obj, fields = ['password', 'bank_details']) => {
  if (!obj) return obj;
  const result = { ...obj };
  fields.forEach((f) => delete result[f]);
  return result;
};

const generateEmployeeCode = () => {
  const prefix = 'EMP';
  const num = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}${num}`;
};

/** Default login password: "{FirstName}{LastName}@123" (no space) */
const generateDefaultPassword = (firstName, lastName) => {
  const fullName = `${firstName || ''}${lastName || ''}`.trim();
  return `${fullName}@123`;
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
  generateEmployeeCode,
  generateDefaultPassword,
};
