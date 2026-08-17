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

const { BlockList, isIP } = require('net');

const normalizeIp = (ip) => {
  if (!ip) return '';
  let v = String(ip).trim().toLowerCase();
  // Strip IPv6 zone id (e.g. fe80::1%eth0)
  if (v.includes('%')) v = v.split('%')[0];
  if (v.startsWith('::ffff:')) v = v.replace('::ffff:', '');
  // Remove surrounding brackets used in URLs [::1]
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v;
};

const looksLikeIp = (value) => isIP(normalizeIp(value)) !== 0;

const isLoopbackIp = (ip) => {
  const v = normalizeIp(ip);
  return v === '127.0.0.1' || v === '::1' || v === '0:0:0:0:0:0:0:1';
};

/** Collect client IPs. Forwarded headers are trusted only from a loopback peer (Vite/ngrok hop). */
const getClientIps = (req) => {
  const candidates = [];
  const push = (raw) => {
    if (!raw) return;
    String(raw).split(',').forEach((part) => {
      const v = normalizeIp(part);
      if (v && looksLikeIp(v) && !candidates.includes(v)) candidates.push(v);
    });
  };

  // Express req.ip already respects `trust proxy` (loopback in this app).
  push(req.ip);
  push(req.socket?.remoteAddress);
  push(req.connection?.remoteAddress);

  const peer = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || '');
  if (isLoopbackIp(peer)) {
    // Leftmost X-Forwarded-For is the original client behind the local proxy.
    push(req.headers['x-forwarded-for']);
    push(req.headers['x-real-ip']);
    push(req.headers['cf-connecting-ip']);
    push(req.headers['true-client-ip']);
    push(req.headers['x-client-ip']);
  }

  return candidates;
};

/**
 * Pick the best client IP for display / primary checks.
 * Never prefer 127.0.0.1 / ::1 when a real remote IP exists (Vite→API hop).
 */
const getClientIp = (req) => {
  const ips = getClientIps(req);
  const remote = ips.filter((ip) => !isLoopbackIp(ip));
  const pool = remote.length ? remote : ips;

  const v4 = pool.find((ip) => isIP(ip) === 4);
  if (v4) return v4;
  const v6 = pool.find((ip) => isIP(ip) === 6);
  if (v6) return v6;
  return pool[0] || '';
};

const ipInCidr = (ip, cidr) => {
  if (!cidr) return false;
  const normalizedIp = normalizeIp(ip);
  const family = isIP(normalizedIp);
  if (!family) return false;

  const ranges = String(cidr)
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ranges.length) return false;

  return ranges.some((entry) => {
    try {
      const raw = entry.trim();
      if (!raw.includes('/')) {
        const entryIp = normalizeIp(raw);
        if (isIP(entryIp) !== family) return false;
        if (family === 4) return entryIp === normalizedIp;
        const bl = new BlockList();
        bl.addAddress(entryIp, 'ipv6');
        return bl.check(normalizedIp, 'ipv6');
      }

      const slash = raw.lastIndexOf('/');
      const range = normalizeIp(raw.slice(0, slash));
      const bits = Number(raw.slice(slash + 1));
      if (!isIP(range) || !Number.isFinite(bits)) return false;
      if (isIP(range) !== family) return false;

      const bl = new BlockList();
      bl.addSubnet(range, bits, family === 6 ? 'ipv6' : 'ipv4');
      return bl.check(normalizedIp, family === 6 ? 'ipv6' : 'ipv4');
    } catch {
      return false;
    }
  });
};

/** True if any observed client IP matches the office whitelist. */
const anyIpInCidr = (ips, cidr) => {
  const list = (Array.isArray(ips) ? ips : [ips]).filter(Boolean);
  // Prefer matching non-loopback IPs (ngrok/phone). Fall back to all if only localhost.
  const remote = list.filter((ip) => !isLoopbackIp(ip));
  const pool = remote.length ? remote : list;
  return pool.some((ip) => ipInCidr(ip, cidr));
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

/**
 * Cryptographically random temporary password (never derived from name).
 * Meets typical policy: length 14, upper, lower, digit, special.
 */
const generateDefaultPassword = () => {
  const crypto = require('crypto');
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const all = upper + lower + digits + special;
  const pick = (set) => set[crypto.randomInt(0, set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  for (let i = chars.length; i < 14; i += 1) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

/** Escape user text for PostgREST `.or()` / `.ilike` filter strings. */
const escapePostgrestFilter = (value) => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/%/g, '\\%')
  .replace(/_/g, '\\_')
  .replace(/,/g, ' ')
  .replace(/\(/g, ' ')
  .replace(/\)/g, ' ')
  .replace(/\./g, ' ');

module.exports = {
  successResponse,
  errorResponse,
  getClientIp,
  getClientIps,
  anyIpInCidr,
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
  escapePostgrestFilter,
};
