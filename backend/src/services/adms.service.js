const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');

/** eSSL ADMS ATTLOG status codes -> our punch_type. */
const STATUS_TO_PUNCH_TYPE = {
  0: 'checkin',
  1: 'checkout',
  4: 'overtime_in',
  5: 'overtime_out',
};

/** eSSL ADMS ATTLOG verify codes -> our verify_mode. */
const VERIFY_TO_MODE = {
  0: 'fingerprint',
  1: 'password',
  2: 'card',
  15: 'face',
};

const touchHeartbeat = async (deviceSerial) => {
  if (!deviceSerial) return;
  const { error } = await supabaseAdmin
    .from('device_heartbeats')
    .upsert({ device_serial: deviceSerial, last_seen_at: new Date().toISOString() }, { onConflict: 'device_serial' });
  if (error) logger.error('[ADMS] Failed to record heartbeat', { deviceSerial, error: error.message });
};

/** "2026-08-21 09:15:00" (device-local IST, naive) -> ISO instant. */
const parseDeviceTimestamp = (raw) => {
  const parsed = moment.tz(String(raw || '').trim(), 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
  return parsed.isValid() ? parsed.toISOString() : null;
};

/**
 * One ATTLOG line: USER_ID\tTIMESTAMP\tSTATUS\tVERIFY\t...(ignored trailing fields).
 * Returns null for lines that can't be parsed at all (blank lines, short lines).
 */
const parseAttlogLine = (line, deviceSerial) => {
  const fields = line.split('\t');
  if (fields.length < 2) return null;

  const [deviceUserId, timestampRaw, statusRaw, verifyRaw] = fields;
  if (!deviceUserId || !timestampRaw) return null;

  const punchTime = parseDeviceTimestamp(timestampRaw);
  if (!punchTime) return null;

  const statusCode = Number(statusRaw);
  const verifyCode = Number(verifyRaw);

  return {
    device_user_id: String(deviceUserId).trim(),
    punch_time: punchTime,
    punch_type: STATUS_TO_PUNCH_TYPE[statusCode] || 'unknown',
    verify_mode: VERIFY_TO_MODE[verifyCode] || null,
    device_serial: deviceSerial || null,
    raw_data: line,
  };
};

/** Parse a full ADMS cdata body (one or more \n-separated ATTLOG lines). */
const parseAttlogBody = (body, deviceSerial) =>
  String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseAttlogLine(line, deviceSerial))
    .filter(Boolean);

/** Look up employee_id + company_id for each distinct device_user_id in one query. */
const mapPunchesToEmployees = async (punches) => {
  const deviceUserIds = [...new Set(punches.map((p) => p.device_user_id))];
  if (!deviceUserIds.length) return punches;

  const { data: employees, error } = await supabaseAdmin
    .from('employees')
    .select('id, company_id, device_user_id')
    .in('device_user_id', deviceUserIds);

  if (error) {
    logger.error('[ADMS] Employee lookup failed', { error: error.message });
    return punches;
  }

  const byDeviceUserId = new Map((employees || []).map((e) => [e.device_user_id, e]));
  return punches.map((p) => {
    const employee = byDeviceUserId.get(p.device_user_id);
    return {
      ...p,
      employee_id: employee?.id || null,
      company_id: employee?.company_id || null,
    };
  });
};

/** Insert punches, silently skipping ones already seen (same device_user_id + punch_time). */
const savePunches = async (punches) => {
  if (!punches.length) return { inserted: 0 };

  const enriched = await mapPunchesToEmployees(punches);
  const { error } = await supabaseAdmin
    .from('device_punches')
    .upsert(enriched, { onConflict: 'device_user_id,punch_time', ignoreDuplicates: true });

  if (error) {
    logger.error('[ADMS] Failed to save punches', { error: error.message, count: enriched.length });
    return { inserted: 0, error };
  }

  const unmatched = enriched.filter((p) => !p.employee_id);
  if (unmatched.length) {
    logger.warn('[ADMS] Punch(es) with no employee mapping', {
      deviceUserIds: [...new Set(unmatched.map((p) => p.device_user_id))],
    });
  }

  return { inserted: enriched.length };
};

const todayRangeIso = () => {
  const start = moment.tz(TIMEZONE).startOf('day').toISOString();
  const end = moment.tz(TIMEZONE).endOf('day').toISOString();
  return { start, end };
};

module.exports = {
  touchHeartbeat,
  parseAttlogBody,
  savePunches,
  todayRangeIso,
};
