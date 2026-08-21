const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { successResponse } = require('../utils/helpers');
const { ForbiddenError } = require('../utils/errors');
const admsService = require('../services/adms.service');

/** Device sends this every ~30s. No auth — the eSSL protocol can't send any. */
const getrequest = async (req, res) => {
  const deviceSerial = req.query.SN || null;
  logger.info('[ADMS] Heartbeat', { deviceSerial });
  await admsService.touchHeartbeat(deviceSerial);
  res.status(200).type('text/plain').send('OK');
};

/** Device sends this once on first connect. No auth. */
const deviceinfo = async (req, res) => {
  const deviceSerial = req.query.SN || null;
  logger.info('[ADMS] Device info', { deviceSerial, body: req.body });
  await admsService.touchHeartbeat(deviceSerial);
  res.status(200).type('text/plain').send('OK');
};

/** Device pushes fingerprint punches here. No auth — always answer OK so it doesn't retry-storm. */
const cdata = async (req, res) => {
  const deviceSerial = req.query.SN || null;
  const table = req.query.table || null;

  try {
    if (table !== 'ATTLOG') {
      logger.info('[ADMS] Ignoring non-ATTLOG cdata push', { deviceSerial, table });
      return res.status(200).type('text/plain').send('OK');
    }

    const punches = admsService.parseAttlogBody(req.body, deviceSerial);
    logger.info('[ADMS] Punch data received', { deviceSerial, lineCount: punches.length });

    const { inserted } = await admsService.savePunches(punches);
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

    const [{ data: recentPunches, error: recentError }, { data: heartbeats }, { count: todayCount }] = await Promise.all([
      supabaseAdmin
        .from('device_punches')
        .select('id, device_user_id, employee_id, punch_time, punch_type, verify_mode, device_serial')
        .eq('company_id', companyId)
        .order('punch_time', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('device_heartbeats')
        .select('device_serial, last_seen_at')
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

    successResponse(res, 'ADMS status', {
      supabaseConnected: !recentError,
      recentPunches: recentPunches || [],
      todayPunchCount: todayCount || 0,
      devices: (heartbeats || []).map((h) => ({
        deviceSerial: h.device_serial,
        lastSeenAt: h.last_seen_at,
      })),
    });
  } catch (err) { next(err); }
};

/** Authenticated: today's raw punches for one employee (self, or another employee if HR/manager scope allows). */
const todayPunches = async (req, res, next) => {
  try {
    const targetEmployeeId = req.query.employee_id || req.user.id;
    if (targetEmployeeId !== req.user.id && !['admin', 'hr', 'manager'].includes(req.user.role)) {
      throw new ForbiddenError('Not allowed to view this employee\'s punches');
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

module.exports = { getrequest, deviceinfo, cdata, testStatus, todayPunches };
