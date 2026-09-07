const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const config = require('../config/database');
const { TIMEZONE } = require('../utils/constants');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const attendanceAnomalyService = require('../services/attendanceAnomaly.service');

/**
 * Item 4: runs early morning, covering the PRIOR calendar day — by then
 * every shift (including overnight ones) has ended and every attendance
 * row for that day is final, so nothing gets flagged on incomplete data.
 * 7:00 AM company timezone, well before the workday starts, so HR's digest
 * lands before anyone's asking about it.
 */
const runAttendanceAnomalyCheck = withCronLock('attendance_anomaly', 20 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running attendance anomaly check (${reason})`);
  const dateStr = moment().tz(TIMEZONE).subtract(1, 'day').format('YYYY-MM-DD');

  const tenantService = require('../services/tenant.service');
  const companies = await tenantService.listActiveCompanies();
  const summary = { reason, date: dateStr, companies: companies.length, flagged: 0, errors: 0 };

  for (const company of companies) {
    try {
      const result = await attendanceAnomalyService.processCompanyDate(company.id, dateStr);
      summary.flagged += result.flagged;
    } catch (err) {
      summary.errors += 1;
      logger.error('[AttendanceAnomaly] Failed for company', { companyId: company.id, error: err.message });
    }
  }

  if (summary.errors > 0) {
    await alertOnCronFailure('attendanceAnomaly', `${summary.errors} of ${summary.companies} companies failed`).catch((e) => {
      logger.error('[CRON] alertOnCronFailure itself failed', { job: 'attendanceAnomaly', error: e.message });
    });
  }

  logger.info('Attendance anomaly check completed', summary);
  return summary;
});

const startAttendanceAnomalyCron = () => {
  // Catch up on server start (if backend was down at 7:00 AM) — safe to
  // re-run even if today's check already happened, same reasoning as
  // autoCheckout/autoPayroll's own startup catch-up call.
  runAttendanceAnomalyCheck('startup').catch(() => {});

  cron.schedule('0 7 * * *', () => runAttendanceAnomalyCheck('cron'), { timezone: config.timezone });

  // Fallback: re-check every 3 hours in case node-cron misses a fire —
  // the attendance_anomaly_alerts_log UNIQUE(employee_id, alert_date)
  // constraint (not just the app-level alreadyAlerted check) is what
  // actually prevents a duplicate email if this runs more than once a day.
  setInterval(() => runAttendanceAnomalyCheck('interval'), 3 * 60 * 60 * 1000);

  logger.info(`Attendance anomaly check scheduled for 7:00 AM ${config.timezone}`);
};

module.exports = { startAttendanceAnomalyCron, runAttendanceAnomalyCheck };
