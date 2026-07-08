const cron = require('node-cron');
const attendanceService = require('../services/attendance.service');
const logger = require('../utils/logger');
const config = require('../config/database');

const startAutoCheckoutCron = () => {
  cron.schedule(
    '0 4 * * *',
    async () => {
      logger.info('Running auto checkout cron job');
      try {
        const result = await attendanceService.processAutoCheckout();
        logger.info('Auto checkout cron completed', result);
      } catch (err) {
        logger.error('Auto checkout cron failed', { error: err.message });
      }
    },
    { timezone: config.timezone }
  );

  logger.info(`Auto checkout cron scheduled for 4:00 AM ${config.timezone}`);
};

module.exports = { startAutoCheckoutCron };
