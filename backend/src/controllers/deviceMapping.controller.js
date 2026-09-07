const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse, getShiftDayWindow, isMissingColumnError } = require('../utils/helpers');
const { TIMEZONE } = require('../utils/constants');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * device_heartbeats.claimed_at (migration 20260907_device_heartbeats_claimed_at.sql)
 * needs to be applied manually via the Supabase SQL editor before it exists.
 * Every read below retries without it on a missing-column error — same
 * per-call fallback this codebase already uses for token_version in
 * auth.middleware.js — so device mapping keeps working exactly as it did
 * before this fix in the interim (no server restart needed once the
 * migration lands; the very next call just starts succeeding with it).
 * The cross-tenant protection itself only takes effect once the column
 * actually exists — this fallback trades that protection for zero downtime,
 * not the other way around, so the migration should still be applied
 * promptly.
 */
const CLAIMED_AT_COL = 'claimed_at';

/**
 * Confirm this device serial is registered to the requesting company (any
 * make/model — nothing hardcoded). Also returns claimed_at so callers can
 * bound punch queries to this company's actual ownership window — see the
 * cross-tenant leak this closes on companyDevices below.
 */
const assertOwnsDevice = async (deviceSerial, companyId) => {
  let { data, error } = await supabaseAdmin
    .from('device_heartbeats')
    .select('device_serial, claimed_at')
    .eq('device_serial', deviceSerial)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error && isMissingColumnError(error.message, CLAIMED_AT_COL)) {
    ({ data, error } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial')
      .eq('device_serial', deviceSerial)
      .eq('company_id', companyId)
      .maybeSingle());
    if (data) data.claimed_at = null;
  }
  if (error) throw error;
  if (!data) throw new NotFoundError('Device not found — register it under Settings > Attendance first');
  return data;
};

/**
 * This company's registered devices, with each one's claimed_at — the
 * scoping boundary for every punch-derived query below.
 *
 * Security audit finding: device_serial is a global primary key and
 * releaseDevice() only clears device_heartbeats.company_id and this
 * company's own device_employee_mapping rows — it never touches
 * device_punches for that serial. A serial can be released by one company
 * and later claimed by an entirely different one (a resold unit, or simply
 * two companies typing the same string), and until claimed_at existed,
 * every punch/device-user query below matched by device_serial membership
 * ALONE, with no lower time bound — the new owner's "Unmapped Punches" and
 * "Device Users" lists would show the previous owner's entire punch
 * history, and mapping a "device user" that looked unmapped could backfill
 * the previous owner's timestamps into this company's employee via
 * backfillPunchesForMapping. Every caller must now pass claimed_at through
 * to a `.gte('punch_time', claimedAt)` filter (skipped when null — a device
 * that's only ever had one owner needs no boundary).
 */
const companyDevices = async (companyId) => {
  let { data, error } = await supabaseAdmin
    .from('device_heartbeats')
    .select('device_serial, claimed_at')
    .eq('company_id', companyId);
  if (error && isMissingColumnError(error.message, CLAIMED_AT_COL)) {
    ({ data, error } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial')
      .eq('company_id', companyId));
    if (data) data = data.map((d) => ({ ...d, claimed_at: null }));
  }
  if (error) throw error;
  const seen = new Map();
  for (const d of data || []) seen.set(d.device_serial, d.claimed_at);
  return [...seen.entries()].map(([deviceSerial, claimedAt]) => ({ deviceSerial, claimedAt }));
};

const withEmployeeName = (row) => {
  const emp = row.employees;
  return {
    id: row.id,
    deviceUserId: row.device_user_id,
    deviceSerial: row.device_serial,
    employeeId: row.employee_id,
    employeeName: emp ? `${emp.first_name} ${emp.last_name}`.trim() : null,
    employeeCode: emp?.employee_code || null,
    createdAt: row.created_at,
  };
};

/**
 * Bug report: an employee who was punching a physical device daily before
 * ever being mapped had every one of those punches sitting in device_punches
 * with employee_id null (see the unmapped() endpoint below) — mapping them
 * afterward only affected FUTURE punches; the historical ones, and the
 * attendance those days should have produced, stayed orphaned forever even
 * though the raw data was already sitting in the DB the whole time.
 *
 * Backfills on mapping creation: reattaches every existing unmapped punch
 * for this exact device_serial + device_user_id to the newly-mapped
 * employee, then recomputes attendance for every shift-day window those
 * punches fall into — using the same recomputeBiometricWindow this
 * session's biometric checkout rework already built for live punches, so
 * the historical days end up with identical grace/finalize semantics
 * (a still-open historical window would come back pending/provisional; a
 * long-closed one finalizes immediately, both correct for their actual age).
 * company_id here is req.user.company_id, already the company both the
 * device (assertOwnsDevice) and the employee (query below) were just
 * validated against — no separate cross-company re-derivation needed,
 * unlike adms.service.js's live-ingestion path which has no such guarantee.
 */
const BACKFILL_PAGE_SIZE = 1000;

const backfillPunchesForMapping = async (deviceSerial, deviceUserId, employeeId, companyId, claimedAt) => {
  // Paginated: PostgREST caps an unbounded select at 1000 rows by default —
  // for anyone with more than ~1000 lifetime unmapped punches (any regular
  // biometric user over a year or so), a single unpaged fetch silently
  // backfilled only the most recent slice and left the rest orphaned,
  // reproducing almost the exact bug this function exists to fix. Looped
  // to completion instead of trusting one call to return everything.
  const punches = [];
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    let query = supabaseAdmin
      .from('device_punches')
      .select('id, punch_time')
      .eq('device_serial', deviceSerial)
      .eq('device_user_id', deviceUserId)
      .is('employee_id', null);
    // Never backfill punches from BEFORE this company's current claim on the
    // device — see companyDevices' doc comment for the cross-tenant leak
    // this closes on a released-and-reclaimed serial.
    if (claimedAt) query = query.gte('punch_time', claimedAt);
    const { data: page, error: punchesError } = await query
      .order('id', { ascending: true })
      .range(0, BACKFILL_PAGE_SIZE - 1);
    if (punchesError) {
      logger.error('[DeviceMapping] Backfill lookup failed', { error: punchesError.message });
      return { backfilled: punches.length, windowsRecomputed: 0 };
    }
    if (!page.length) break;
    punches.push(...page);
    // eslint-disable-next-line no-await-in-loop
    const { error: updateError } = await supabaseAdmin
      .from('device_punches')
      .update({ employee_id: employeeId, company_id: companyId })
      .in('id', page.map((p) => p.id));
    if (updateError) {
      logger.error('[DeviceMapping] Backfill reattach failed', { error: updateError.message });
      return { backfilled: punches.length - page.length, windowsRecomputed: 0 };
    }
    // Reattached rows drop out of the next is('employee_id', null) page,
    // so re-querying from the same range keeps making forward progress
    // rather than needing an offset.
    if (page.length < BACKFILL_PAGE_SIZE) break;
  }
  if (!punches.length) return { backfilled: 0, windowsRecomputed: 0 };

  const attendanceService = require('../services/attendance.service');
  const { data: emp } = await supabaseAdmin.from('employees').select('address').eq('id', employeeId).maybeSingle();
  const attendanceConfig = await attendanceService.getAttendanceConfig(companyId);
  const shiftStart = attendanceService.resolveShiftStart(emp?.address, attendanceConfig.shifts);

  const windowStarts = new Set();
  for (const p of punches) {
    const { windowStart } = getShiftDayWindow(moment(p.punch_time).tz(TIMEZONE), shiftStart);
    windowStarts.add(windowStart.toISOString());
  }
  for (const windowStartIso of windowStarts) {
    // eslint-disable-next-line no-await-in-loop
    await attendanceService.recomputeBiometricWindow(employeeId, windowStartIso).catch((err) => {
      logger.error('[DeviceMapping] Backfill recompute failed', { employeeId, windowStartIso, error: err.message });
    });
  }
  return { backfilled: punches.length, windowsRecomputed: windowStarts.size };
};

/** Only expose mappings/employees that belong to the requesting HR/Admin's company. */
const create = async (req, res, next) => {
  try {
    const { device_user_id: deviceUserId, employee_id: employeeId, device_serial: deviceSerial } = req.body || {};
    if (!deviceUserId || !employeeId || !deviceSerial) {
      throw new BadRequestError('device_user_id, employee_id and device_serial are required');
    }
    const serial = deviceSerial;
    const device = await assertOwnsDevice(serial, req.user.company_id);

    const { data: employee, error: employeeError } = await supabaseAdmin
      .from('employees')
      .select('id, company_id')
      .eq('id', employeeId)
      .eq('company_id', req.user.company_id)
      .maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee) throw new NotFoundError('Employee not found');

    const { data, error } = await supabaseAdmin
      .from('device_employee_mapping')
      .insert({ device_user_id: String(deviceUserId), employee_id: employeeId, device_serial: serial })
      .select('id, device_user_id, device_serial, employee_id, created_at, employees(first_name, last_name, employee_code)')
      .single();

    if (error) {
      if (error.code === '23505') throw new ConflictError('This device user ID is already mapped on this device');
      throw error;
    }

    const backfill = await backfillPunchesForMapping(serial, String(deviceUserId), employeeId, req.user.company_id, device.claimed_at);

    successResponse(res, 'Mapping created', { ...withEmployeeName(data), backfill }, null, 201);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    const devices = await companyDevices(req.user.company_id);
    const serials = devices.map((d) => d.deviceSerial);
    if (!serials.length) return successResponse(res, 'Mappings fetched', []);

    // Cross-tenant isolation: device_employee_mapping has no company_id of
    // its own — device_serial ownership alone isn't enough once an employee
    // can transfer companies (employee.controller.js's update()). !inner +
    // filtering on the joined employees.company_id excludes mapping rows
    // whose employee no longer belongs to this company (stale rows from a
    // completed transfer that predate the purge-on-transfer fix, or any
    // future gap in that cleanup) instead of leaking their name/code here.
    const { data, error } = await supabaseAdmin
      .from('device_employee_mapping')
      .select('id, device_user_id, device_serial, employee_id, created_at, employees!inner(first_name, last_name, employee_code, company_id)')
      .in('device_serial', serials)
      .eq('employees.company_id', req.user.company_id)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (error) throw error;

    successResponse(res, 'Mappings fetched', (data || []).map(withEmployeeName));
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const deviceUserId = req.params.deviceUserId;
    const deviceSerial = req.query.device_serial;
    if (!deviceSerial) throw new BadRequestError('device_serial query param is required');

    const { data: existing, error: findError } = await supabaseAdmin
      .from('device_employee_mapping')
      .select('id, employees(company_id)')
      .eq('device_user_id', deviceUserId)
      .eq('device_serial', deviceSerial)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing || existing.employees?.company_id !== req.user.company_id) {
      throw new NotFoundError('Mapping not found');
    }

    const { error } = await supabaseAdmin.from('device_employee_mapping').delete().eq('id', existing.id);
    if (error) throw error;

    successResponse(res, 'Mapping removed');
  } catch (err) { next(err); }
};

/**
 * Recent punches that arrived with no matching mapping, for this company's
 * registered devices — one query per device rather than a single
 * `.in('device_serial', serials)` so each device's own claimed_at lower
 * bound applies (a device_serial-only filter would surface a released and
 * reclaimed serial's PREVIOUS owner's punches too — see companyDevices'
 * doc comment). Per-device round trips are fine here: a company registers
 * a handful of physical devices, not hundreds.
 */
const unmapped = async (req, res, next) => {
  try {
    const devices = await companyDevices(req.user.company_id);
    if (!devices.length) return successResponse(res, 'Unmapped punches', []);

    const pages = await Promise.all(devices.map(({ deviceSerial, claimedAt }) => {
      let query = supabaseAdmin
        .from('device_punches')
        .select('id, device_user_id, punch_time, punch_type, verify_mode, device_serial')
        .is('employee_id', null)
        .eq('device_serial', deviceSerial);
      if (claimedAt) query = query.gte('punch_time', claimedAt);
      return query.order('punch_time', { ascending: false }).limit(200);
    }));
    for (const p of pages) if (p.error) throw p.error;

    const merged = pages.flatMap((p) => p.data || [])
      .sort((a, b) => new Date(b.punch_time) - new Date(a.punch_time))
      .slice(0, 200);

    successResponse(res, 'Unmapped punches', merged);
  } catch (err) { next(err); }
};

/**
 * Every distinct device_user_id seen from this company's devices, with punch
 * count / last-seen / mapped status — so an admin knows exactly which IDs
 * (e.g. "5") still need mapping to an employee, without touching Supabase.
 */
const deviceUsers = async (req, res, next) => {
  try {
    const devices = await companyDevices(req.user.company_id);
    if (!devices.length) return successResponse(res, 'Device users', { device_users: [] });
    const serials = devices.map((d) => d.deviceSerial);

    // Per-device so each one's claimed_at lower bound applies — same
    // cross-tenant reasoning as unmapped() above.
    const [punchPages, { data: mappings, error: mappingsError }] = await Promise.all([
      Promise.all(devices.map(({ deviceSerial, claimedAt }) => {
        let query = supabaseAdmin
          .from('device_punches')
          .select('device_user_id, punch_time')
          .eq('device_serial', deviceSerial);
        if (claimedAt) query = query.gte('punch_time', claimedAt);
        return query.order('punch_time', { ascending: false }).limit(5000);
      })),
      supabaseAdmin
        .from('device_employee_mapping')
        .select('device_user_id, employees!inner(company_id)')
        .in('device_serial', serials)
        .eq('employees.company_id', req.user.company_id),
    ]);
    for (const p of punchPages) if (p.error) throw p.error;
    if (mappingsError) throw mappingsError;
    const punches = punchPages.flatMap((p) => p.data || []);

    const mappedIds = new Set((mappings || []).map((m) => m.device_user_id));
    const byDeviceUserId = new Map();
    for (const p of punches || []) {
      const entry = byDeviceUserId.get(p.device_user_id);
      if (entry) {
        entry.punch_count += 1;
      } else {
        byDeviceUserId.set(p.device_user_id, {
          device_user_id: p.device_user_id,
          punch_count: 1,
          last_seen: p.punch_time,
          mapped: mappedIds.has(p.device_user_id),
        });
      }
    }

    const deviceUserList = [...byDeviceUserId.values()].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    successResponse(res, 'Device users', { device_users: deviceUserList });
  } catch (err) { next(err); }
};

module.exports = { create, list, remove, unmapped, deviceUsers };
