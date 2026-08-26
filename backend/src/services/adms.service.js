const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');
const { getShiftDayWindow } = require('../utils/helpers');

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

/** A real device batches at most a few hundred punches per push; cap well above that. */
const MAX_ATTLOG_LINES_PER_REQUEST = 2000;

/** Parse a full ADMS cdata body (one or more \n-separated ATTLOG lines). */
const parseAttlogBody = (body, deviceSerial) =>
  String(body || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_ATTLOG_LINES_PER_REQUEST)
    .map((line) => parseAttlogLine(line, deviceSerial))
    .filter(Boolean);

/**
 * Look up employee_id + company_id for each distinct device_user_id via
 * device_employee_mapping (scoped to this device's serial), in one query.
 */
const mapPunchesToEmployees = async (punches, deviceSerial) => {
  const deviceUserIds = [...new Set(punches.map((p) => p.device_user_id))];
  if (!deviceUserIds.length) return punches;

  const { data: mappings, error } = await supabaseAdmin
    .from('device_employee_mapping')
    .select('device_user_id, employee_id, employees(company_id)')
    .eq('device_serial', deviceSerial)
    .in('device_user_id', deviceUserIds);

  if (error) {
    logger.error('[ADMS] Mapping lookup failed', { error: error.message });
    return punches;
  }

  const byDeviceUserId = new Map((mappings || []).map((m) => [m.device_user_id, m]));
  return punches.map((p) => {
    const mapping = byDeviceUserId.get(p.device_user_id);
    if (mapping) {
      logger.info(`[ADMS] punch mapped: device_user_${p.device_user_id} -> employee ${mapping.employee_id}`);
    } else {
      logger.warn(`[ADMS] punch unmapped: device_user_${p.device_user_id} (no mapping found)`);
    }
    return {
      ...p,
      employee_id: mapping?.employee_id || null,
      company_id: mapping?.employees?.company_id || null,
    };
  });
};

/** Insert punches, silently skipping ones already seen (same device_user_id + punch_time). */
const savePunches = async (punches, deviceSerial) => {
  if (!punches.length) return { inserted: 0 };

  const enriched = await mapPunchesToEmployees(punches, deviceSerial);
  const { error } = await supabaseAdmin
    .from('device_punches')
    .upsert(enriched, { onConflict: 'device_serial,device_user_id,punch_time', ignoreDuplicates: true });

  if (error) {
    logger.error('[ADMS] Failed to save punches', { error: error.message, count: enriched.length });
    return { inserted: 0, error };
  }

  await syncAffectedAttendanceDays(enriched);

  return { inserted: enriched.length };
};

/**
 * Turn today's (and any backlogged) mapped punches into real attendance records —
 * first/last punch per shift-day window, anchored to each employee's own assigned
 * shift start (not midnight), so overnight shifts bucket into the right day.
 */
const syncAffectedAttendanceDays = async (punches) => {
  const attendanceService = require('./attendance.service');

  const punchesByEmployee = new Map();
  for (const p of punches) {
    if (!p.employee_id) continue;
    if (!punchesByEmployee.has(p.employee_id)) punchesByEmployee.set(p.employee_id, []);
    punchesByEmployee.get(p.employee_id).push(p);
  }

  await Promise.all(
    [...punchesByEmployee.entries()].map(async ([employeeId, empPunches]) => {
      const shiftStart = await attendanceService.getEmployeeShiftStart(employeeId).catch(() => '09:30');
      const windowStartIsos = new Set(
        empPunches.map((p) => getShiftDayWindow(moment.tz(p.punch_time, TIMEZONE), shiftStart).windowStart.toISOString())
      );

      await Promise.all(
        [...windowStartIsos].map((windowStartIso) =>
          attendanceService.syncAttendanceFromDevicePunches(employeeId, windowStartIso).catch((err) => {
            logger.error('[ADMS] Attendance sync failed', { employeeId, windowStartIso, error: err.message });
          })
        )
      );
    })
  );
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
