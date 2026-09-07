const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { TIMEZONE } = require('../utils/constants');
const { getShiftDayWindow } = require('../utils/helpers');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

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

const isMissingDeviceSecretColumn = (message) => /column .*device_secret.* does not exist/i.test(String(message || ''));

/**
 * The ADMS protocol has no auth of its own — this is the only gate between
 * "anyone who knows/guesses a device_serial + device_user_id pair" and a
 * real attendance write that flows into payroll. Two layers:
 *  1. The serial must already be claimed to a company via registerDevice
 *     (device_heartbeats.company_id set) — an unclaimed serial has no
 *     tenant to attribute punches to, so it's rejected outright rather than
 *     silently accepted as an orphaned row.
 *  2. If that company has opted into a device_secret (hardening, optional
 *     for backward compat with devices that can't send custom headers),
 *     the caller must present the exact matching secret.
 * Throws ForbiddenError (403, unclaimed device) or UnauthorizedError
 * (401, wrong/missing secret) — callers must catch and alert, not just log.
 */
const assertDeviceAuthorized = async (deviceSerial, providedSecret) => {
  if (!deviceSerial) {
    throw new ForbiddenError('Device serial (SN) is required');
  }

  let device;
  {
    const { data, error } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial, company_id, device_secret')
      .eq('device_serial', deviceSerial)
      .maybeSingle();

    if (error && isMissingDeviceSecretColumn(error.message)) {
      // Migration 20260827_device_secret.sql not applied yet in this
      // environment — fall back to serial+company_id-only authorization
      // (no secret can be required or checked until the column exists).
      const fallback = await supabaseAdmin
        .from('device_heartbeats')
        .select('device_serial, company_id')
        .eq('device_serial', deviceSerial)
        .maybeSingle();
      if (fallback.error) {
        logger.error('[ADMS] Device authorization lookup failed', { deviceSerial, error: fallback.error.message });
        throw new ForbiddenError('Device is not registered');
      }
      device = fallback.data ? { ...fallback.data, device_secret: null } : null;
    } else if (error) {
      logger.error('[ADMS] Device authorization lookup failed', { deviceSerial, error: error.message });
      throw new ForbiddenError('Device is not registered');
    } else {
      device = data;
    }
  }

  if (!device || !device.company_id) {
    throw new ForbiddenError('Device is not registered to a company');
  }

  if (device.device_secret && device.device_secret !== providedSecret) {
    throw new UnauthorizedError('Invalid or missing device secret');
  }

  return device.company_id;
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
 * `registeredCompanyId` is the company this serial is actually claimed to
 * (from assertDeviceAuthorized) — any resolved mapping pointing to a
 * DIFFERENT company is a data-integrity or spoofing anomaly (device mapping
 * creation is itself company-scoped, so this should never happen through
 * normal use) and is dropped rather than written, with a security alert.
 */
const mapPunchesToEmployees = async (punches, deviceSerial, registeredCompanyId) => {
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
  const result = [];
  let crossCompanyDropped = 0;

  for (const p of punches) {
    const mapping = byDeviceUserId.get(p.device_user_id);
    if (!mapping) {
      logger.warn(`[ADMS] punch unmapped: device_user_${p.device_user_id} (no mapping found)`);
      result.push({ ...p, employee_id: null, company_id: null });
      continue;
    }

    const mappedCompanyId = mapping.employees?.company_id || null;
    if (registeredCompanyId && mappedCompanyId && mappedCompanyId !== registeredCompanyId) {
      crossCompanyDropped += 1;
      logger.error('[ADMS] Dropped punch: mapped employee belongs to a different company than the registered device', {
        deviceSerial, deviceUserId: p.device_user_id, employeeId: mapping.employee_id,
        mappedCompanyId, registeredCompanyId,
      });
      continue;
    }

    logger.info(`[ADMS] punch mapped: device_user_${p.device_user_id} -> employee ${mapping.employee_id}`);
    result.push({ ...p, employee_id: mapping.employee_id, company_id: mappedCompanyId });
  }

  if (crossCompanyDropped > 0) {
    await alertOnUnauthorizedDevice(
      deviceSerial,
      `${crossCompanyDropped} punch(es) mapped to an employee outside the device's registered company were dropped.`,
    ).catch((e) => logger.error('[ADMS] alertOnUnauthorizedDevice failed', { error: e.message }));
  }

  return result;
};

/**
 * Same rate-limited email-alert pattern as alertOnSaveFailure below, but for
 * a rejected/anomalous device request (unclaimed serial, wrong device
 * secret, or a cross-company mapping) instead of a DB save failure — this is
 * the only signal anyone gets that someone is probing or misusing the
 * unauthenticated ADMS endpoints, since the device/attacker always still
 * sees a plain rejection with no further detail.
 */
const UNAUTHORIZED_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const UNAUTHORIZED_ALERT_SETTING_KEY = 'adms_unauthorized_last_alert_at';

const alertOnUnauthorizedDevice = async (deviceSerial, reason, meta = {}) => {
  const settingsService = require('./settings.service');
  const now = Date.now();
  const lastAlertIso = await settingsService.getSetting(UNAUTHORIZED_ALERT_SETTING_KEY, null, null);
  const lastAlertAt = lastAlertIso ? new Date(lastAlertIso).getTime() : 0;
  if (now - lastAlertAt < UNAUTHORIZED_ALERT_COOLDOWN_MS) return;
  await settingsService.setSetting(UNAUTHORIZED_ALERT_SETTING_KEY, new Date(now).toISOString(), null, null);

  const to = process.env.SUPER_ADMIN_EMAIL;
  if (!to) return;

  const { sendEmail } = require('./email.service');
  sendEmail({
    to,
    subject: `[ADMS ALERT] Rejected/anomalous device request (${deviceSerial || 'unknown device'})`,
    html: `<p>A request to the biometric device endpoints was rejected or produced an anomaly.</p>
<p>Device: <strong>${deviceSerial || 'unknown'}</strong></p>
<p>Reason: <code>${reason}</code></p>
${meta.ip ? `<p>Source IP: <code>${meta.ip}</code></p>` : ''}
<p>This may be a misconfigured device or an attempt to push forged attendance data through <code>/iclock/cdata</code>.</p>
<p>(This alert is rate-limited to once every 15 minutes while it continues.)</p>`,
  }).catch((e) => logger.error('[ADMS] Failed to send unauthorized-device alert email', { error: e.message }));
};

/**
 * A genuine DB-level save failure here is silent to the device — the ADMS
 * response to the device always says "OK" regardless (deliberately, to avoid
 * a retry-storm on routine cases like an unmapped user), so nothing tells
 * anyone this class of failure is happening except server logs. Alert by
 * email the moment it starts, rate-limited so a sustained outage sends one
 * notice per window instead of one per punch.
 */
const SAVE_FAILURE_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const SAVE_FAILURE_ALERT_SETTING_KEY = 'adms_save_failure_last_alert_at';

const alertOnSaveFailure = async (deviceSerial, errorMessage, count) => {
  // Backed by system_settings (not an in-memory variable) so the cooldown is
  // shared across every server instance/worker, not reset per-process.
  const settingsService = require('./settings.service');
  const now = Date.now();
  const lastAlertIso = await settingsService.getSetting(SAVE_FAILURE_ALERT_SETTING_KEY, null, null);
  const lastAlertAt = lastAlertIso ? new Date(lastAlertIso).getTime() : 0;
  if (now - lastAlertAt < SAVE_FAILURE_ALERT_COOLDOWN_MS) return;
  await settingsService.setSetting(SAVE_FAILURE_ALERT_SETTING_KEY, new Date(now).toISOString(), null, null);

  const to = process.env.SUPER_ADMIN_EMAIL;
  if (!to) return;

  const { sendEmail } = require('./email.service');
  sendEmail({
    to,
    subject: `[ADMS ALERT] Biometric punches are failing to save (${deviceSerial || 'unknown device'})`,
    html: `<p>Device <strong>${deviceSerial || 'unknown'}</strong> is pushing punches successfully, but they are failing to save to the database.</p>
<p>Error: <code>${errorMessage}</code></p>
<p>Punches are being lost silently until this is fixed — check the ADMS logs and the <code>device_punches</code> table/constraints immediately.</p>
<p>(This alert is rate-limited to once every 15 minutes while the failure continues.)</p>`,
  }).catch((e) => logger.error('[ADMS] Failed to send save-failure alert email', { error: e.message }));
};

/**
 * Section G2: data_collection_mode='stop' for biometric_adms — punches are
 * still ACKNOWLEDGED to the device (the caller always gets "OK" regardless,
 * per the existing comment above on alertOnSaveFailure — nothing here
 * changes that), but never reach `attendance` or even `device_punches`.
 * Written instead to adms_discarded_punches (purged after 7 days — a
 * reversibility window, not silent permanent loss). Deliberately the ONLY
 * change to this file's write path — assertDeviceAuthorized, parsing, and
 * the C-01 device-isolation logic above are all untouched.
 */
const discardPunchesForStoppedCollection = async (punches, deviceSerial, companyId) => {
  const rows = punches.map((p) => ({ company_id: companyId, device_serial: deviceSerial, raw_punch_data: p }));
  const { error } = await supabaseAdmin.from('adms_discarded_punches').insert(rows);
  if (error) logger.error('[ADMS] Failed to write discarded punches', { error: error.message, count: rows.length });
  logger.info('[ADMS] Punches discarded — data_collection_mode is stop', { companyId, deviceSerial, count: punches.length });

  // Opportunistic purge (>7 days old) on the way in — piggybacks on real
  // traffic rather than needing a dedicated cron registration for what's a
  // low-volume, best-effort housekeeping table.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  supabaseAdmin.from('adms_discarded_punches').delete().lt('discarded_at', cutoff)
    .then(({ error: purgeError }) => {
      if (purgeError) logger.warn('[ADMS] Discarded-punch purge failed', { error: purgeError.message });
    });
};

/** Insert punches, silently skipping ones already seen (same device_user_id + punch_time). */
const savePunches = async (punches, deviceSerial, registeredCompanyId) => {
  if (!punches.length) return { inserted: 0 };

  if (registeredCompanyId) {
    const featureOverrideService = require('./featureOverride.service');
    const mode = await featureOverrideService.getDataCollectionMode(registeredCompanyId, 'biometric_adms');
    if (mode === 'stop') {
      await discardPunchesForStoppedCollection(punches, deviceSerial, registeredCompanyId);
      return { inserted: 0, discarded: punches.length };
    }
  }

  const enriched = await mapPunchesToEmployees(punches, deviceSerial, registeredCompanyId);
  const { error } = await supabaseAdmin
    .from('device_punches')
    .upsert(enriched, { onConflict: 'device_serial,device_user_id,punch_time', ignoreDuplicates: true });

  if (error) {
    logger.error('[ADMS] Failed to save punches', { error: error.message, count: enriched.length });
    await alertOnSaveFailure(deviceSerial, error.message, enriched.length).catch((e) => {
      logger.error('[ADMS] alertOnSaveFailure itself failed', { error: e.message });
    });
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
          attendanceService.recomputeBiometricWindow(employeeId, windowStartIso).catch((err) => {
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
  assertDeviceAuthorized,
  alertOnUnauthorizedDevice,
};
