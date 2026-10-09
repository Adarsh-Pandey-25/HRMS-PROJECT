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
 'totp_secret',
 'totpSecret',
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

const { BlockList, isIP } = require('net');

const normalizeIp = (ip) => {
 if (!ip) return '';
 let v = String(ip).trim().toLowerCase();
 if (v.includes('%')) v = v.split('%')[0];
 if (v.startsWith('::ffff:')) v = v.replace('::ffff:', '');
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

 push(req.ip);
 push(req.socket?.remoteAddress);
 push(req.connection?.remoteAddress);

 const peer = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || '');
 if (isLoopbackIp(peer)) {
 push(req.headers['x-forwarded-for']);
 push(req.headers['x-real-ip']);
 push(req.headers['cf-connecting-ip']);
 push(req.headers['true-client-ip']);
 push(req.headers['x-client-ip']);
 }

 return candidates;
};

/** Pick the best client IP for display / primary checks. */
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

/**
 * How far before a shift's start its attendance day begins. A punch up to
 * this many hours early is an early arrival for that shift; before it, the
 * punch is the tail of the previous day (a late check-out, or the end of an
 * overnight shift).
 *
 * The day used to begin exactly at shift start, so anyone arriving even a
 * minute early — a 09:13 punch for a 09:30 shift — was filed under the
 * previous day: it became yesterday's check-out (a "22h 37m" day) and today
 * started from their evening punch, or showed as absent.
 */
const SHIFT_WINDOW_LEAD_HOURS = 6;

const parseHm = (hm, fallbackHour = 9, fallbackMinute = 30) => {
 const [h, m] = String(hm || '').split(':').map(Number);
 return {
  hour: Number.isFinite(h) ? h : fallbackHour,
  minute: Number.isFinite(m) ? m : fallbackMinute,
 };
};

/**
 * standardStartTime is "HH:mm" — the employee's assigned shift start, or the default 09:30.
 * Returns the attendance day (a 24h window) that contains `referenceMoment`:
 *  - windowStart / windowEnd: the day's bounds — from SHIFT_WINDOW_LEAD_HOURS before
 *    the shift starts, for 24 hours;
 *  - shiftStart: when that day's shift starts (lateness is measured from here);
 *  - workDate: the date the day belongs to (the shift start's date).
 * Works the same for every shift timing, including ones that cross midnight: for a
 * 22:00-07:00 shift a 06:50 punch belongs to yesterday's shift and a 21:45 punch to today's.
 */
const getShiftDayWindow = (referenceMoment, standardStartTime = '09:30') => {
 const ref = moment(referenceMoment).tz(TIMEZONE);
 const { hour, minute } = parseHm(standardStartTime);

 let shiftStart = ref.clone().hour(hour).minute(minute).second(0).millisecond(0);
 let windowStart = shiftStart.clone().subtract(SHIFT_WINDOW_LEAD_HOURS, 'hours');
 if (ref.isBefore(windowStart)) {
  shiftStart = shiftStart.subtract(1, 'day');
 } else if (!ref.isBefore(windowStart.clone().add(1, 'day'))) {
  shiftStart = shiftStart.add(1, 'day');
 }
 windowStart = shiftStart.clone().subtract(SHIFT_WINDOW_LEAD_HOURS, 'hours');
 const windowEnd = windowStart.clone().add(1, 'day');
 return { windowStart, windowEnd, shiftStart, workDate: shiftStart.format('YYYY-MM-DD') };
};

/** The attendance day for a calendar date (YYYY-MM-DD) — same bounds as getShiftDayWindow. */
const getShiftDayWindowForDate = (dateStr, standardStartTime = '09:30') => {
 const { hour, minute } = parseHm(standardStartTime);
 const shiftStart = moment.tz(dateStr, 'YYYY-MM-DD', TIMEZONE).hour(hour).minute(minute).second(0).millisecond(0);
 const windowStart = shiftStart.clone().subtract(SHIFT_WINDOW_LEAD_HOURS, 'hours');
 return { windowStart, windowEnd: windowStart.clone().add(1, 'day'), shiftStart, workDate: dateStr };
};

/** The shift start time of the attendance day a window begins (inverse of getShiftDayWindow). */
const shiftStartOfWindow = (windowStart) => moment(windowStart).tz(TIMEZONE).add(SHIFT_WINDOW_LEAD_HOURS, 'hours');

/**
 * Whether a check-in is late: after the day's shift start plus the grace period.
 */
const isLateCheckIn = (checkIn, gracePeriodMinutes = 15, standardStartTime = '09:30') => {
 const checkInMoment = moment(checkIn).tz(TIMEZONE);
 const { shiftStart } = getShiftDayWindow(checkInMoment, standardStartTime);
 return checkInMoment.isAfter(shiftStart.clone().add(Number(gracePeriodMinutes) || 0, 'minutes'));
};

/**
 * The day's status from when someone arrived and how long they worked —
 * one rule for every check-in method (web, office network, biometric, HR
 * entry). Short hours decide first: half the shift or less is a half day
 * whether or not they were also late. (Web check-in used to test "late"
 * first, so arriving late and leaving early was paid as a full day.)
 *
 *   < halfDayPercent of the shift  → half_day
 *   < the shift                    → early_departure
 *   full shift, but arrived late   → late
 *   otherwise                      → present
 */
const determineAttendanceStatus = (
 checkIn, totalHours, isLateThreshold = 30, standardStartTime = '09:30',
 { expectedHours = WORK_HOURS, halfDayPercent = 50 } = {},
) => {
 const expected = Number(expectedHours) > 0 ? Number(expectedHours) : WORK_HOURS;
 const halfDayHours = expected * ((Number(halfDayPercent) > 0 ? Number(halfDayPercent) : 50) / 100);
 const hours = Number(totalHours) || 0;
 if (hours < halfDayHours) return 'half_day';
 if (hours < expected) return 'early_departure';
 if (isLateCheckIn(checkIn, isLateThreshold, standardStartTime)) return 'late';
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
const generateEmployeeCode = () => 'EMP001';

/**
 * Cryptographically random temporary password (never derived from name).
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

/** Escape user text for PostgREST filter strings. */
const escapePostgrestFilter = (value) => String(value || '')
 .replace(/\\/g, '\\\\')
 .replace(/%/g, '\\%')
 .replace(/_/g, '\\_')
 .replace(/,/g, ' ')
 .replace(/\(/g, ' ')
 .replace(/\)/g, ' ')
 .replace(/\./g, ' ');

/**
 * Confirmed live (2026-08-28, direct testing during item 3's build): a
 * missing-column error from Supabase/PostgREST shows up in at least two
 * different message shapes — "Could not find the 'x' column of 'y' in the schema
 * cache" (PostgREST's schema-cache miss) and "column employees.x does not exist"
 * (a raw Postgres error surfacing through). This checks for both.
 */
const isMissingColumnError = (message, columnName) => {
 const msg = String(message || '').toLowerCase();
 const col = String(columnName || '').toLowerCase();
 if (!col || !msg.includes(col)) return false;
 return msg.includes('does not exist') || msg.includes('schema cache');
};

module.exports = {
 successResponse,
 isMissingColumnError,
 getClientIp,
 getClientIps,
 anyIpInCidr,
 normalizeIp,
 ipInCidr,
 nowIST,
 toIST,
 calculateWorkingHours,
 getShiftDayWindow,
 getShiftDayWindowForDate,
 shiftStartOfWindow,
 isLateCheckIn,
 SHIFT_WINDOW_LEAD_HOURS,
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
