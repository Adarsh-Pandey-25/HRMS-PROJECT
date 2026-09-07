const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/helpers');
const { ForbiddenError, BadRequestError, ConflictError, NotFoundError } = require('../utils/errors');
const admsService = require('../services/adms.service');
const featureOverrideService = require('../services/featureOverride.service');

/**
 * Device sends this every ~30s. No auth — the eSSL protocol can't send any.
 * Responding with an ATTLOG command nudges the device to push any punches
 * it's holding on the very next request instead of waiting on its own timer.
 */
const getrequest = async (req, res) => {
  const deviceSerial = req.query.SN || null;
  logger.info('[ADMS] Heartbeat', { deviceSerial });
  await admsService.touchHeartbeat(deviceSerial);
  res.status(200).type('text/plain').send('OK\nGetRequest:ATTLOG');
};

/** Device sends this once on first connect. No auth. */
const deviceinfo = async (req, res) => {
  const deviceSerial = req.query.SN || null;
  // Unauthenticated, attacker-controlled input — log a capped preview only, never the raw body verbatim.
  const bodyPreview = String(req.body || '').slice(0, 200);
  logger.info('[ADMS] Device info', { deviceSerial, bodyLength: String(req.body || '').length, bodyPreview });
  await admsService.touchHeartbeat(deviceSerial);
  res.status(200).type('text/plain').send('OK');
};

/**
 * Device pushes fingerprint punches here. No protocol-level auth — but
 * unlike benign save failures (which always answer OK to avoid a
 * retry-storm), an authorization rejection (unclaimed serial, wrong/missing
 * device secret) is a genuine "reject" — 403/401 — since accepting the
 * write is the actual vulnerability being closed here, not a transient
 * infra failure. Every rejection is alerted the same way save failures are.
 */
const cdata = async (req, res) => {
  const deviceSerial = req.query.SN || null;
  const table = req.query.table || null;
  const providedSecret = req.headers['x-device-secret'] || req.query.device_secret || null;

  let registeredCompanyId;
  try {
    registeredCompanyId = await admsService.assertDeviceAuthorized(deviceSerial, providedSecret);
  } catch (err) {
    const status = err.statusCode || 403;
    logger.warn('[ADMS] Rejected unauthorized cdata push', { deviceSerial, ip: req.ip, status, reason: err.message });
    await admsService.alertOnUnauthorizedDevice(deviceSerial, err.message, { ip: req.ip }).catch((e) => {
      logger.error('[ADMS] alertOnUnauthorizedDevice failed', { error: e.message });
    });
    return res.status(status).type('text/plain').send('NOK');
  }

  try {
    if (table !== 'ATTLOG') {
      logger.info('[ADMS] Ignoring non-ATTLOG cdata push', { deviceSerial, table });
      return res.status(200).type('text/plain').send('OK');
    }

    const punches = admsService.parseAttlogBody(req.body, deviceSerial);
    logger.info('[ADMS] Punch data received', { deviceSerial, lineCount: punches.length });

    const { inserted } = await admsService.savePunches(punches, deviceSerial, registeredCompanyId);
    logger.info('[ADMS] Punches saved', { deviceSerial, inserted });
  } catch (err) {
    logger.error('[ADMS] cdata handler failed', { deviceSerial, error: err.message });
  }

  res.status(200).type('text/plain').send('OK');
};

/** Authenticated: HR/Admin dashboard check on the ADMS pipeline. */
const testStatus = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;

    const [
      { data: recentPunches, error: recentError },
      { data: heartbeats, error: heartbeatsError },
      { count: todayCount, error: todayError },
    ] = await Promise.all([
      supabaseAdmin
        .from('device_punches')
        .select('id, device_user_id, employee_id, punch_time, punch_type, verify_mode, device_serial')
        .eq('company_id', companyId)
        .order('punch_time', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('device_heartbeats')
        .select('device_serial, last_seen_at, name, location')
        .eq('company_id', companyId)
        .order('last_seen_at', { ascending: false }),
      (async () => {
        const { start, end } = admsService.todayRangeIso();
        return supabaseAdmin
          .from('device_punches')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .gte('punch_time', start)
          .lte('punch_time', end);
      })(),
    ]);

    if (recentError) throw recentError;
    if (heartbeatsError) throw heartbeatsError;
    if (todayError) throw todayError;

    successResponse(res, 'ADMS status', {
      supabaseConnected: true,
      recentPunches: recentPunches || [],
      todayPunchCount: todayCount || 0,
      devices: (heartbeats || []).map((h) => ({
        deviceSerial: h.device_serial,
        lastSeenAt: h.last_seen_at,
        name: h.name,
        location: h.location,
      })),
    });
  } catch (err) { next(err); }
};

/**
 * Authenticated: HR/Admin registers or relabels a device by serial — this is
 * the only way a device ever gets associated with a company. Any device
 * serial works (typed by the admin from whatever's printed on their unit);
 * nothing in the codebase assumes a specific make/model/serial.
 *
 * - Serial never seen before -> claimed for this company now.
 * - Serial already claimed by this company -> just updates name/location.
 * - Serial already claimed by a DIFFERENT company -> rejected. The device
 *   itself is unauthenticated (the ADMS protocol has no way to prove
 *   ownership), so first-to-register is the only enforceable rule; this at
 *   least stops one tenant from silently taking over another's device entry.
 */
const registerDevice = async (req, res, next) => {
  try {
    const { serial } = req.params;
    const { name, location } = req.body || {};
    if (!serial) throw new BadRequestError('Device serial is required');
    const companyId = req.user.company_id;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial, last_seen_at, name, location, company_id')
      .eq('device_serial', serial)
      .maybeSingle();
    if (findError) throw findError;

    if (existing?.company_id && existing.company_id !== companyId) {
      throw new ConflictError('This device is already registered to another company');
    }

    if (existing) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('device_heartbeats')
        .update({ name: name ?? null, location: location ?? null, company_id: companyId })
        .eq('device_serial', serial)
        .select('device_serial, last_seen_at, name, location')
        .single();
      if (updateError) throw updateError;
      return successResponse(res, 'Device updated', {
        deviceSerial: updated.device_serial,
        lastSeenAt: updated.last_seen_at,
        name: updated.name,
        location: updated.location,
      });
    }

    // Device hasn't pinged yet — pre-register it so it's claimed the moment it does.
    const { data: created, error: insertError } = await supabaseAdmin
      .from('device_heartbeats')
      .insert({ device_serial: serial, name: name ?? null, location: location ?? null, company_id: companyId })
      .select('device_serial, last_seen_at, name, location')
      .single();
    if (insertError) throw insertError;

    successResponse(res, 'Device registered', {
      deviceSerial: created.device_serial,
      lastSeenAt: created.last_seen_at,
      name: created.name,
      location: created.location,
    }, null, 201);
  } catch (err) { next(err); }
};

/**
 * Authenticated: HR/Admin releases a device its own company currently owns —
 * the counterpart to registerDevice's "first-to-register" claim. Without
 * this, a resold/redistributed physical device stays permanently bound to
 * its original company (registerDevice rejects any other company's claim
 * outright, see the comment there) with no self-service handoff path.
 *
 * Also purges this company's device_employee_mapping rows for the serial —
 * those numeric-device-ID mappings only make sense in the context of the
 * company that owned the device. Leaving them in place after release would
 * both block whoever claims the serial next from ever mapping that
 * device_user_id (UNIQUE(device_user_id, device_serial)) and leak this
 * company's employee names/codes to them via a live join — the same
 * cross-tenant identity leak pattern closed for employee transfers in
 * employee.controller.js's update().
 */
const releaseDevice = async (req, res, next) => {
  try {
    const { serial } = req.params;
    if (!serial) throw new BadRequestError('Device serial is required');
    const companyId = req.user.company_id;

    const { data: existing, error: findError } = await supabaseAdmin
      .from('device_heartbeats')
      .select('device_serial, company_id')
      .eq('device_serial', serial)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing || existing.company_id !== companyId) {
      throw new NotFoundError('Device not found — register it under Settings > Attendance first');
    }

    const { error: mappingError } = await supabaseAdmin
      .from('device_employee_mapping')
      .delete()
      .eq('device_serial', serial);
    if (mappingError) throw mappingError;

    const { error: releaseError } = await supabaseAdmin
      .from('device_heartbeats')
      .update({ company_id: null, name: null, location: null })
      .eq('device_serial', serial);
    if (releaseError) throw releaseError;

    successResponse(res, 'Device released');
  } catch (err) { next(err); }
};

/** Authenticated: today's raw punches for one employee (self, or another employee if HR/manager scope allows). */
const todayPunches = async (req, res, next) => {
  try {
    const targetEmployeeId = req.query.employee_id || req.user.id;

    if (targetEmployeeId !== req.user.id) {
      if (!['admin', 'hr', 'manager'].includes(req.user.role)) {
        throw new ForbiddenError('Not allowed to view this employee\'s punches');
      }
      // Same company/team scope every other attendance endpoint enforces —
      // a client-supplied employee_id must never reach across tenants or
      // outside a manager's own reports.
      const tenantService = require('../services/tenant.service');
      const attendanceService = require('../services/attendance.service');
      const allowedIds = ['admin', 'hr'].includes(req.user.role)
        ? await tenantService.getOrgEmployeeIds(req.user.company_id)
        : await attendanceService.getTeamEmployeeIds(req.user.id, req.user.company_id);
      if (!allowedIds.includes(targetEmployeeId)) {
        throw new NotFoundError('Employee not found');
      }
    }

    // Item 8: this endpoint is exclusively biometric content (raw device_punches),
    // unlike the mixed attendance-row endpoints elsewhere — when the company
    // can't see biometric data at all, this returns empty rather than a
    // 403, matching item 8B's "the company should have no way to discover
    // this exists" philosophy applied here too.
    if (!(await featureOverrideService.hasFeature(req.user.company_id, 'biometric_adms'))) {
      successResponse(res, 'Today\'s device punches', []);
      return;
    }

    const { start, end } = admsService.todayRangeIso();
    const { data, error } = await supabaseAdmin
      .from('device_punches')
      .select('id, device_user_id, employee_id, punch_time, punch_type, verify_mode, device_serial')
      .eq('employee_id', targetEmployeeId)
      .gte('punch_time', start)
      .lte('punch_time', end)
      .order('punch_time', { ascending: true });

    if (error) throw error;
    successResponse(res, 'Today\'s device punches', data || []);
  } catch (err) { next(err); }
};

module.exports = { getrequest, deviceinfo, cdata, testStatus, registerDevice, releaseDevice, todayPunches };
