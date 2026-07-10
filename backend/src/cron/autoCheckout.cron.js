const cron = require('node-cron');
const attendanceService = require('../services/attendance.service');
const logger = require('../utils/logger');
const config = require('../config/database');

const runAutoCheckout = async (reason = 'cron') => {
  logger.info(`Running auto checkout (${reason})`);
  try {
    const result = await attendanceService.processAutoCheckout();
    logger.info('Auto checkout completed', { reason, ...result });
    return result;
  } catch (err) {
    logger.error('Auto checkout failed', { reason, error: err.message });
    return { processed: 0, error: err.message };
  }
};

const startAutoCheckoutCron = () => {
  // Catch up on server start (if backend was down at 4:00 AM)
  runAutoCheckout('startup').catch(() => {});

  cron.schedule(
    '0 4 * * *',
    () => runAutoCheckout('cron'),
    { timezone: config.timezone }
  );

  // Fallback: node-cron can miss on Windows/sleep — re-check every 15 minutes
  setInterval(() => runAutoCheckout('interval'), 15 * 60 * 1000);

  logger.info(`Auto checkout cron scheduled for 4:00 AM ${config.timezone}`);
};

module.exports = { startAutoCheckoutCron, runAutoCheckout };
