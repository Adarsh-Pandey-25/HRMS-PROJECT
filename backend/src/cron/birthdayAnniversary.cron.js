const cron = require('node-cron');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { birthdayWishEmail, workAnniversaryEmail } = require('../services/email.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const { DEFAULT_COMPANY_ID } = require('../utils/tenant');
const { TIMEZONE } = require('../utils/constants');

/** Canonical notification types — these exact strings are what
 *  notification.service.js's resolveTriggerEvent() maps to the
 *  "Birthday reminder" / "Work anniversary reminder" Settings triggers. */
const TYPE_BIRTHDAY = 'BIRTHDAY';
const TYPE_ANNIVERSARY = 'ANNIVERSARY';

const displayName = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim();
const plural = (n) => (Number(n) === 1 ? '' : 's');

/**
 * Active employees whose birthday and/or work anniversary falls on `dateStr`,
 * matched on month-day so it is year-independent.
 *
 * An employee's own joining day is deliberately NOT an anniversary — that is
 * 0 years of service, and they already receive the welcome email. Only the
 * first and subsequent yearly repeats count.
 */
async function findCelebrants(dateStr) {
  const m = moment(dateStr);
  const monthDay = m.format('MM-DD');
  const currentYear = m.year();

  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, date_of_birth, date_of_joining, company_id')
    .eq('is_active', true);

  if (error) {
    logger.error('[BirthdayAnniversary] Employee query failed', { error: error.message });
    return [];
  }

  const celebrants = [];
  for (const emp of data || []) {
    const dob = emp.date_of_birth;
    const doj = emp.date_of_joining;

    const isBirthday = Boolean(dob) && moment(dob).format('MM-DD') === monthDay;
    const joinDayMatches = Boolean(doj) && moment(doj).format('MM-DD') === monthDay;
    const yearsOfService = joinDayMatches ? currentYear - moment(doj).year() : 0;
    const isAnniversary = joinDayMatches && yearsOfService >= 1;

    if (isBirthday || isAnniversary) {
      celebrants.push({ ...emp, isBirthday, isAnniversary, yearsOfService });
    }
  }
  return celebrants;
}

/**
 * Wish the celebrant directly: a dedicated branded email plus one in-app
 * notification. The notification is created with skipEmail because the
 * branded email above is already this event's email — without it the
 * notification service would send a second, generic copy of the same news.
 */
async function celebrate(celebrant) {
  const name = displayName(celebrant);
  const years = celebrant.yearsOfService;

  if (celebrant.isBirthday && celebrant.email) {
    await birthdayWishEmail(celebrant).catch((err) =>
      logger.warn('[BirthdayAnniversary] Birthday email failed', { employeeId: celebrant.id, error: err.message }));
  }
  if (celebrant.isAnniversary && celebrant.email) {
    await workAnniversaryEmail(celebrant, years).catch((err) =>
      logger.warn('[BirthdayAnniversary] Anniversary email failed', { employeeId: celebrant.id, error: err.message }));
  }

  let title;
  let message;
  if (celebrant.isBirthday && celebrant.isAnniversary) {
    title = 'Happy Birthday & Work Anniversary!';
    message = `Wishing you a wonderful birthday — and celebrating ${years} year${plural(years)} with us today!`;
  } else if (celebrant.isBirthday) {
    title = 'Happy Birthday!';
    message = `Wishing you a wonderful birthday, ${celebrant.first_name || name}!`;
  } else {
    title = 'Happy Work Anniversary!';
    message = `Celebrating ${years} year${plural(years)} with us today — thank you for everything you bring to the team.`;
  }

  try {
    await notificationService.createNotification({
      user_id: celebrant.id,
      type: celebrant.isBirthday ? TYPE_BIRTHDAY : TYPE_ANNIVERSARY,
      title,
      message,
      link: '/dashboard',
      meta: {
        employee_id: celebrant.id,
        is_birthday: celebrant.isBirthday,
        is_anniversary: celebrant.isAnniversary,
        years_of_service: years,
      },
      skipEmail: true,
    });
  } catch (err) {
    logger.warn('[BirthdayAnniversary] Celebrant notification failed', { employeeId: celebrant.id, error: err.message });
  }
}

/**
 * Tell the rest of the company so colleagues can send wishes. In-app only
 * (skipEmail) — emailing every employee about every birthday would be spam;
 * the celebrant themselves still gets the branded email in celebrate().
 */
async function broadcastToCompany(celebrant, companyId) {
  const name = displayName(celebrant);
  const years = celebrant.yearsOfService;

  let title;
  let message;
  if (celebrant.isBirthday && celebrant.isAnniversary) {
    title = `${name} — birthday & work anniversary today`;
    message = `It's ${name}'s birthday, and they're celebrating ${years} year${plural(years)} with us. Send them your wishes!`;
  } else if (celebrant.isBirthday) {
    title = `${name}'s birthday today`;
    message = `It's ${name}'s birthday today — send them your best wishes!`;
  } else {
    title = `${name}'s work anniversary today`;
    message = `${name} is celebrating ${years} year${plural(years)} with us today!`;
  }

  try {
    const { data: employees, error } = await supabaseAdmin
      .from('employees')
      .select('id')
      .eq('company_id', companyId)
      .eq('is_active', true);
    if (error) throw new Error(error.message);

    const rows = (employees || [])
      .filter((e) => e.id !== celebrant.id)
      .map((e) => ({
        user_id: e.id,
        type: celebrant.isBirthday ? TYPE_BIRTHDAY : TYPE_ANNIVERSARY,
        title,
        message,
        link: `/employees/${celebrant.id}`,
        meta: {
          celebrant_id: celebrant.id,
          celebrant_name: name,
          is_birthday: celebrant.isBirthday,
          is_anniversary: celebrant.isAnniversary,
          years_of_service: years,
        },
        skipEmail: true,
      }));

    if (rows.length) await notificationService.createNotifications(rows);
  } catch (err) {
    logger.warn('[BirthdayAnniversary] Company broadcast failed', {
      companyId, employeeId: celebrant.id, error: err.message,
    });
  }
}

const runBirthdayAnniversaryCheck = withCronLock('birthday_anniversary', 5 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running birthday/anniversary check (${reason})`);

  const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const summary = { reason, date: today, celebrants: 0, errors: 0 };

  try {
    const celebrants = await findCelebrants(today);
    if (!celebrants.length) {
      logger.info('Birthday/anniversary check: no celebrants today', summary);
      return summary;
    }

    const tenantService = require('../services/tenant.service');
    const companies = await tenantService.listActiveCompanies();
    const activeCompanyIds = new Set((companies || []).map((c) => String(c.id)));

    for (const c of celebrants) {
      const companyId = String(c.company_id || DEFAULT_COMPANY_ID);
      if (!activeCompanyIds.has(companyId)) continue;
      try {
        await celebrate(c);
        await broadcastToCompany(c, companyId);
        summary.celebrants += 1;
      } catch (err) {
        summary.errors += 1;
        logger.error('[BirthdayAnniversary] Failed for employee', { employeeId: c.id, error: err.message });
      }
    }
  } catch (err) {
    summary.errors += 1;
    logger.error('Birthday/anniversary check failed', { reason, error: err.message });
    await alertOnCronFailure('birthdayAnniversary', err.message).catch((e) => {
      logger.error('[CRON] alertOnCronFailure itself failed', { job: 'birthdayAnniversary', error: e.message });
    });
  }

  logger.info('Birthday/anniversary check completed', summary);
  return summary;
});

const startBirthdayAnniversaryCron = () => {
  // Catch up on server start, in case the process was down at 8:00 AM.
  runBirthdayAnniversaryCheck('startup').catch(() => {});

  cron.schedule(
    '0 8 * * *',
    () => runBirthdayAnniversaryCheck('cron').catch(() => {}),
    { timezone: config.timezone },
  );

  // Fallback sweep: node-cron can miss a fire on Windows/sleep. Wrapped so a
  // rejection here can never surface as an unhandled rejection (which this
  // process treats as fatal — see server.js).
  setInterval(() => runBirthdayAnniversaryCheck('interval').catch(() => {}), 4 * 60 * 60 * 1000);

  logger.info(`Birthday/anniversary cron scheduled for 8:00 AM ${config.timezone}`);
};

module.exports = { startBirthdayAnniversaryCron, runBirthdayAnniversaryCheck };
