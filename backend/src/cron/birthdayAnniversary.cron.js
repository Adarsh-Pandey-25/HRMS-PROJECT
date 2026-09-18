const { supabaseAdmin } = require('../config/supabase');
const { birthdayWishEmail, workAnniversaryEmail } = require('../services/email.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');
const { TIMEZONE } = require('../utils/constants');

/**
 * Find active employees whose birthday or work anniversary falls on the given
 * date (month-day match, year-independent for birthdays; year-count for anniversaries).
 */
async function findCelebrants(dateStr) {
  const m = moment(dateStr);
  const monthDay = m.format('MM-DD');
  const currentYear = m.year();

  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, date_of_birth, date_of_joining, company_id, role, department, is_active')
    .neq('is_active', false);

  if (error) {
    logger.error('[BirthdayAnniversary] Query failed', { error: error.message });
    return [];
  }

  const celebrants = [];
  for (const emp of (data || [])) {
    const dob = emp.date_of_birth || emp.dateOfBirth;
    const doj = emp.date_of_joining || emp.dateOfJoining;

    const birthdayMatch = dob && moment(dob).format('MM-DD') === monthDay;
    const anniversaryMatch = doj && moment(doj).format('MM-DD') === monthDay;

    if (birthdayMatch || anniversaryMatch) {
      const anniversaryYear = doj ? moment(doj).year() : null;
      const yearsOfService = anniversaryYear ? currentYear - anniversaryYear : null;

      celebrants.push({
        ...emp,
        isBirthday: Boolean(birthdayMatch),
        isAnniversary: Boolean(anniversaryMatch),
        yearsOfService,
      });
    }
  }
  return celebrants;
}

/**
 * Send birthday/anniversary wishes to the employee and notify all company staff.
 */
async function celebrate(celebrant, companyId) {
  const fullName = `${celebrant.first_name || ''} ${celebrant.last_name || ''}`.trim();

  if (celebrant.isBirthday) {
    await birthdayWishEmail(celebrant).catch((err) =>
      logger.warn('[BirthdayAnniversary] Birthday email failed', { employeeId: celebrant.id, error: err.message }),
    );
  }

  if (celebrant.isAnniversary && celebrant.yearsOfService > 0) {
    await workAnniversaryEmail(celebrant, celebrant.yearsOfService).catch((err) =>
      logger.warn('[BirthdayAnniversary] Anniversary email failed', { employeeId: celebrant.id, error: err.message }),
    );
  }

  // In-app notification to the celebrant
  const notifType = celebrant.isBirthday && celebrant.isAnniversary ? 'birthday_anniversary' : celebrant.isBirthday ? 'birthday' : 'work_anniversary';
  const notifTitle = celebrant.isBirthday && celebrant.isAnniversary
    ? 'Happy Birthday & Work Anniversary!'
    : celebrant.isBirthday
      ? 'Happy Birthday!'
      : 'Happy Work Anniversary!';
  const yearsText = celebrant.yearsOfService ? ` (${celebrant.yearsOfService} year${celebrant.yearsOfService > 1 ? 's' : ''})` : '';

  const notifMessage = celebrant.isBirthday && celebrant.isAnniversary
    ? `Wishing you a wonderful birthday and celebrating your ${celebrant.yearsOfService || 'first'} year${(celebrant.yearsOfService || 1) > 1 ? 's' : ''} with us!`
    : celebrant.isBirthday
      ? 'Wishing you a wonderful birthday!'
      : `Celebrating ${yearsText} with us today — thank you for your contribution!`;

  try {
    await notificationService.createNotification({
      user_id: celebrant.id,
      type: notifType.toUpperCase(),
      title: notifTitle,
      message: notifMessage,
      link: '/dashboard',
      meta: {
        employee_id: celebrant.id,
        is_birthday: celebrant.isBirthday,
        is_anniversary: celebrant.isAnniversary,
        years_of_service: celebrant.yearsOfService,
      },
    });
  } catch (err) {
    logger.warn('[BirthdayAnniversary] Notification failed', { employeeId: celebrant.id, error: err.message });
  }
}

/**
 * Broadcast a notification to all employees in the company about a colleague's
 * birthday or work anniversary, so the whole team can send wishes.
 */
async function broadcastToCompany(celebrant, companyId) {
  const fullName = `${celebrant.first_name || ''} ${celebrant.last_name || ''}`.trim();

  let title, message;
  if (celebrant.isBirthday && celebrant.isAnniversary) {
    title = `${fullName} — Birthday & Work Anniversary today`;
    message = `Celebrate ${fullName}'s birthday and ${celebrant.yearsOfService || 'first'} year${(celebrant.yearsOfService || 1) > 1 ? 's' : ''} in the company!`;
  } else if (celebrant.isBirthday) {
    title = `${fullName}'s birthday today`;
    message = `It's ${fullName}'s birthday today — send them your best wishes!`;
  } else {
    title = `${fullName}'s work anniversary today`;
    message = `${fullName} is celebrating ${celebrant.yearsOfService} year${celebrant.yearsOfService > 1 ? 's' : ''} with us today!`;
  }

  try {
    const { data: employees } = await supabaseAdmin
      .from('employees')
      .select('id, email, is_active')
      .eq('company_id', companyId)
      .neq('is_active', false);

    const recipients = (employees || []).filter((e) => e.id !== celebrant.id && e.email);
    const notificationRows = recipients.map((e) => ({
      user_id: e.id,
      type: celebrant.isAnniversary ? 'WORK_ANNIVERSARY' : 'BIRTHDAY',
      title,
      message,
      link: `/employees/${celebrant.id}`,
      meta: {
        celebrant_id: celebrant.id,
        celebrant_name: fullName,
        is_birthday: celebrant.isBirthday,
        is_anniversary: celebrant.isAnniversary,
        years_of_service: celebrant.yearsOfService,
      },
      is_read: false,
    }));

    if (notificationRows.length > 0) {
      await supabaseAdmin.from('notifications').insert(notificationRows);
    }
  } catch (err) {
    logger.warn('[BirthdayAnniversary] Broadcast failed', { companyId, employeeId: celebrant.id, error: err.message });
  }
}

const runBirthdayAnniversaryCheck = withCronLock('birthday_anniversary', 5 * 60 * 1000, async (reason = 'cron') => {
  logger.info(`Running birthday/anniversary check (${reason})`);

  const today = moment().tz(TIMEZONE).format('YYYY-MM-DD');
  const celebrants = await findCelebrants(today);

  if (!celebrants.length) {
    logger.info('Birthday/anniversary check: no celebrants today');
    return { date: today, celebrants: 0 };
  }

  const tenantService = require('../services/tenant.service');
  const companies = await tenantService.listActiveCompanies();
  const companyMap = new Map((companies || []).map((c) => [c.id, c.id]));

  let processed = 0;
  for (const c of celebrants) {
    const companyId = String(c.company_id || DEFAULT_COMPANY_ID);
    if (!companyMap.has(companyId)) continue;

    await celebrate(c, companyId);
    await broadcastToCompany(c, companyId);
    processed += 1;
  }

  logger.info('Birthday/anniversary check completed', { date: today, celebrants: processed });
  return { date: today, celebrants: processed };
});

const startBirthdayAnniversaryCron = () => {
  // Run on startup to catch up (if server was down at 8 AM)
  runBirthdayAnniversaryCheck('startup').catch(() => {});

  // Every day at 8:00 AM company timezone
  cron.schedule('0 8 * * *', () => runBirthdayAnniversaryCheck('cron').catch(() => {}), { timezone: require('../config/database').timezone });

  // Fallback re-check every 4 hours — wrapped to prevent unhandled rejections
  // from the distributed cronLock's fetch-based mechanism killing the process.
  const intervalId = setInterval(() => runBirthdayAnniversaryCheck('interval').catch(() => {}), 4 * 60 * 60 * 1000);

  logger.info(`Birthday/anniversary cron scheduled for 8:00 AM ${require('../config/database').timezone}`);
};

module.exports = { startBirthdayAnniversaryCron, runBirthdayAnniversaryCheck };
