const cron = require('node-cron');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const salaryRevisionService = require('../services/salaryRevision.service');

/** Applies future-dated salary revisions on their effective date. */
const runSalaryRevisions = withCronLock('salary_revisions', 5 * 60 * 1000, async (reason = 'cron') => {
  try {
    const result = await salaryRevisionService.applyDueRevisions();
    logger.info('Salary revisions applied', { reason, ...result });
    if (result.failed) {
      await alertOnCronFailure('salaryRevisions', JSON.stringify(result)).catch(() => {});
    }
    return result;
  } catch (err) {
    logger.error('[SalaryRevision] Cron failed', { error: err.message });
    await alertOnCronFailure('salaryRevisions', err.message).catch(() => {});
    return { error: err.message };
  }
});

const startSalaryRevisionCron = () => {
  // Catch up on anything that became due while the server was down.
  runSalaryRevisions('startup').catch(() => {});
  cron.schedule('5 0 * * *', () => runSalaryRevisions('cron'), { timezone: config.timezone });
  logger.info(`Salary revision cron scheduled for 12:05 AM ${config.timezone}`);
};

module.exports = { startSalaryRevisionCron, runSalaryRevisions };
