const cron = require('node-cron');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { prejoiningEmail, dayOneEmail } = require('../services/email.service');
const emailPreferencesService = require('../services/emailPreferences.service');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const { DEFAULT_COMPANY_ID } = require('../utils/tenant');
const { TIMEZONE } = require('../utils/constants');

const SALT_ROUNDS = 10;
const TEMP_PASSWORD_EXPIRY_HOURS = 48;

const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12))
    .map((b) => chars[b % chars.length])
    .join('');
};

const getCompanyId = (emp) =>
  emp.company_id ? String(emp.company_id) : DEFAULT_COMPANY_ID;

/**
 * FIX 6A — Pre-joining reminder: fires N days before an employee's date_of_joining.
 * Gives new hires their logistics info (report time, location, dress code) in advance.
 */
const PRE_JOINING_DAYS_BEFORE = parseInt(process.env.PRE_JOINING_DAYS_BEFORE ?? '2', 10);
const runPrejoiningCheck = withCronLock('onboarding_prejoining', 5 * 60 * 1000, async (reason = 'cron') => {
  const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const targetDate = moment().tz(TIMEZONE).add(PRE_JOINING_DAYS_BEFORE, 'days').format('YYYY-MM-DD');
  const summary = { reason, date: today, targetDate, sent: 0, errors: 0 };

  try {
    const { data: employees, error } = await supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, email, date_of_joining, company_id, address')
      .eq('date_of_joining', targetDate)
      .not('email', 'is', null);

    if (error) throw new Error(error.message);
    if (!employees || !employees.length) {
      logger.info('[Onboarding] No pre-joining emails to send', summary);
      return summary;
    }

    for (const emp of employees) {
      const companyId = getCompanyId(emp);
      if (!await emailPreferencesService.isEmailEnabled(companyId, 'prejoining_reminder')) continue;
      try {
        await prejoiningEmail(emp);
        summary.sent += 1;
      } catch (err) {
        summary.errors += 1;
        logger.warn('[Onboarding] Pre-joining email failed', { employeeId: emp.id, error: err.message });
      }
    }
  } catch (err) {
    summary.errors += 1;
    logger.error('[Onboarding] Pre-joining check failed', { reason, error: err.message });
    await alertOnCronFailure('onboarding_prejoining', err.message).catch((e) =>
      logger.error('[CRON] alertOnCronFailure failed', { job: 'onboarding_prejoining', error: e.message }));
  }

  logger.info('[Onboarding] Pre-joining check completed', summary);
  return summary;
});

/**
 * FIX 6B — Day-one welcome: fires on the employee's date_of_joining for employees who have
 * must_change_password=true (i.e., no password has been set yet). Generates a fresh 48h
 * temp password, updates the hash in DB, and emails login credentials.
 *
 * Skips employees whose date_of_joining is today but who already set their own password
 * (must_change_password=false), since they don't need credentials in email.
 */
const runDayOneCheck = withCronLock('onboarding_day_one', 5 * 60 * 1000, async (reason = 'cron') => {
  const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const summary = { reason, date: today, sent: 0, errors: 0 };

  try {
    const { data: employees, error } = await supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, email, date_of_joining, company_id, address, must_change_password')
      .eq('date_of_joining', today)
      .eq('must_change_password', true)
      .not('email', 'is', null);

    if (error) throw new Error(error.message);
    if (!employees || !employees.length) {
      logger.info('[Onboarding] No day-one emails to send', summary);
      return summary;
    }

    for (const emp of employees) {
      const companyId = getCompanyId(emp);
      if (!await emailPreferencesService.isEmailEnabled(companyId, 'day_one_welcome')) continue;
      try {
        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
        const expiresAt = new Date(Date.now() + TEMP_PASSWORD_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

        const { error: updateError } = await supabaseAdmin
          .from('employees')
          .update({ password_hash: passwordHash, temp_password_expires_at: expiresAt })
          .eq('id', emp.id);

        if (updateError) {
          logger.warn('[Onboarding] Failed to set temp password', { employeeId: emp.id, error: updateError.message });
          continue;
        }

        await dayOneEmail(emp, tempPassword, TEMP_PASSWORD_EXPIRY_HOURS);
        summary.sent += 1;
      } catch (err) {
        summary.errors += 1;
        logger.warn('[Onboarding] Day-one email failed', { employeeId: emp.id, error: err.message });
      }
    }
  } catch (err) {
    summary.errors += 1;
    logger.error('[Onboarding] Day-one check failed', { reason, error: err.message });
    await alertOnCronFailure('onboarding_day_one', err.message).catch((e) =>
      logger.error('[CRON] alertOnCronFailure failed', { job: 'onboarding_day_one', error: e.message }));
  }

  logger.info('[Onboarding] Day-one check completed', summary);
  return summary;
});

const startOnboardingCron = () => {
  runPrejoiningCheck('startup').catch(() => {});
  runDayOneCheck('startup').catch(() => {});

  // Pre-joining: 7AM daily
  cron.schedule('0 7 * * *', () => runPrejoiningCheck('cron').catch(() => {}), { timezone: config.timezone });
  // Day-one: 7:30AM daily (slightly after pre-joining to avoid lock contention)
  cron.schedule('30 7 * * *', () => runDayOneCheck('cron').catch(() => {}), { timezone: config.timezone });

  setInterval(() => runPrejoiningCheck('interval').catch(() => {}), 12 * 60 * 60 * 1000);
  setInterval(() => runDayOneCheck('interval').catch(() => {}), 12 * 60 * 60 * 1000);

  logger.info(`Onboarding crons scheduled (7:00 AM pre-joining, 7:30 AM day-one) ${config.timezone}`);
};

module.exports = { startOnboardingCron, runPrejoiningCheck, runDayOneCheck };
