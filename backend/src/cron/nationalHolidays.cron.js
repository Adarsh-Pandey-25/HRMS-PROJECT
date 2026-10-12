const cron = require('node-cron');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { ensureForAllCompanies } = require('../services/nationalHolidays.service');

/**
 * Keeps every company's calendar stocked with the national holidays for this
 * year and next — at startup and on the 1st of each month, so a new year is
 * always ready before it starts. Adds each year once; sends no email.
 */
const runNationalHolidays = withCronLock('national_holidays', 5 * 60 * 1000, async (reason = 'cron') => {
  const year = moment.tz(config.timezone).year();
  try {
    const result = await ensureForAllCompanies([year, year + 1]);
    logger.info('[NationalHolidays] Checked', { reason, ...result });
    return result;
  } catch (err) {
    logger.error('[NationalHolidays] Run failed', { reason, error: err.message });
    return { error: err.message };
  }
});

const startNationalHolidaysCron = () => {
  runNationalHolidays('startup').catch(() => {});
  cron.schedule('20 3 1 * *', () => runNationalHolidays('cron').catch(() => {}), { timezone: config.timezone });
  logger.info(`National holidays cron scheduled for 3:20 AM on the 1st, ${config.timezone}`);
};

module.exports = { startNationalHolidaysCron, runNationalHolidays };
