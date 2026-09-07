const cron = require('node-cron');
const payrollService = require('../services/payroll.service');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');

const runAutoPayroll = withCronLock('auto_payroll', 15 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running auto payroll (${reason})`);
  try {
    const result = await payrollService.processAutoPayroll(reason);
    logger.info('Auto payroll completed', {
      reason,
      companies: result.companies,
      ran: result.ran,
      skipped: result.skipped,
      errors: result.errors,
    });
    return result;
  } catch (err) {
    logger.error('Auto payroll failed', { reason, error: err.message });
    await alertOnCronFailure('autoPayroll', err.message).catch((e) => {
      logger.error('[CRON] alertOnCronFailure itself failed', { job: 'autoPayroll', error: e.message });
    });
    return { ran: 0, skipped: 0, errors: 1, error: err.message };
  }
});

const startAutoPayrollCron = () => {
  // Daily at 06:00 company timezone — companies with auto_process + matching run_date generate drafts.
  cron.schedule(
    '0 6 * * *',
    () => runAutoPayroll('cron'),
    { timezone: config.timezone },
  );

  // Catch missed windows (server sleep / restart) without re-running same month (idempotent).
  setInterval(() => runAutoPayroll('interval'), 60 * 60 * 1000);

  logger.info(`Auto payroll cron scheduled for 6:00 AM ${config.timezone}`);
};

module.exports = { startAutoPayrollCron, runAutoPayroll };
