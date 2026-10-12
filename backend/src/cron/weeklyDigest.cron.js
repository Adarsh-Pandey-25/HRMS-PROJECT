const cron = require('node-cron');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const {
  pendingApprovalsDigestEmail,
  joinerDigestEmail,
} = require('../services/email.service');
const emailPreferencesService = require('../services/emailPreferences.service');
const { getHrEmailRecipients } = require('../services/emailRecipients.service');
const logger = require('../utils/logger');
const config = require('../config/database');
const { withCronLock } = require('../utils/cronLock');
const { alertOnCronFailure } = require('../utils/cronAlert');
const { DEFAULT_COMPANY_ID } = require('../utils/tenant');
const { TIMEZONE } = require('../utils/constants');

const getCompanyId = (emp) =>
  emp.company_id ? String(emp.company_id) : DEFAULT_COMPANY_ID;

/**
 * FIX 6D — Pending approvals digest: daily 8:30AM.
 * Sends each HR/Admin employee a list of pending leave requests in their company.
 * Only fires when there is at least one pending item.
 */
const runPendingApprovalsDigest = withCronLock('digest_pending_approvals', 10 * 60 * 1000, async (reason = 'cron') => {
  const today = moment().tz(TIMEZONE);
  const dateLabel = today.format('ddd, D MMM');
  const summary = { reason, date: today.format('YYYY-MM-DD'), sent: 0, skipped: 0, errors: 0 };

  try {
    const tenantService = require('../services/tenant.service');
    const companies = await tenantService.listActiveCompanies();

    for (const company of companies || []) {
      const companyId = String(company.id);
      if (!await emailPreferencesService.isEmailEnabled(companyId, 'pending_approvals_digest')) {
        summary.skipped += 1;
        continue;
      }

      // Pending leaves for this company
      const { data: pendingLeaves, error: leavesError } = await supabaseAdmin
        .from('leaves')
        .select('id, leave_type, from_date, to_date, total_days, employee:employee_id(id, first_name, last_name)')
        .eq('company_id', companyId)
        .eq('status', 'pending');

      if (leavesError) {
        logger.warn('[WeeklyDigest] Pending leaves query failed', { companyId, error: leavesError.message });
        summary.errors += 1;
        continue;
      }

      if (!pendingLeaves || !pendingLeaves.length) continue;

      // HR only — see emailRecipients.service.js.
      let recipients;
      try {
        recipients = await getHrEmailRecipients(companyId);
      } catch (recipientsError) {
        logger.warn('[WeeklyDigest] Recipients query failed', { companyId, error: recipientsError.message });
        summary.errors += 1;
        continue;
      }

      if (!recipients.length) continue;

      const leaveItems = pendingLeaves.map((l) => ({
        name: l.employee
          ? `${l.employee.first_name || ''} ${l.employee.last_name || ''}`.trim()
          : 'Unknown',
      }));

      const groups = [
        {
          label: `Leave requests (${pendingLeaves.length})`,
          items: leaveItems,
          iconBg: '#FEF3C7',
          iconColor: '#D97706',
        },
      ];

      for (const recipient of recipients) {
        if (!recipient.email) continue;
        try {
          await pendingApprovalsDigestEmail(recipient, dateLabel, groups);
          summary.sent += 1;
        } catch (err) {
          summary.errors += 1;
          logger.warn('[WeeklyDigest] Pending approvals email failed', {
            companyId, recipientId: recipient.id, error: err.message,
          });
        }
      }
    }
  } catch (err) {
    summary.errors += 1;
    logger.error('[WeeklyDigest] Pending approvals digest failed', { reason, error: err.message });
    await alertOnCronFailure('digest_pending_approvals', err.message).catch((e) =>
      logger.error('[CRON] alertOnCronFailure failed', { job: 'digest_pending_approvals', error: e.message }));
  }

  logger.info('[WeeklyDigest] Pending approvals digest completed', summary);
  return summary;
});

/**
 * FIX 6E — Joiner/exit digest: weekly (Monday 9AM).
 * Sends HR/Admin a count + list of employees who joined or were deactivated in the last 7 days.
 */
const runJoinerDigest = withCronLock('digest_joiners', 10 * 60 * 1000, async (reason = 'cron') => {
  const today = moment().tz(TIMEZONE);
  const weekAgo = today.clone().subtract(7, 'days').format('YYYY-MM-DD');
  const todayStr = today.format('YYYY-MM-DD');
  const weekLabel = `${moment(weekAgo).format('D MMM')} – ${today.format('D MMM YYYY')}`;
  const summary = { reason, weekLabel, sent: 0, skipped: 0, errors: 0 };

  try {
    const tenantService = require('../services/tenant.service');
    const companies = await tenantService.listActiveCompanies();

    for (const company of companies || []) {
      const companyId = String(company.id);
      if (!await emailPreferencesService.isEmailEnabled(companyId, 'joiner_digest')) {
        summary.skipped += 1;
        continue;
      }

      const [joinersRes, exitsRes, headcountRes, recipients] = await Promise.all([
        supabaseAdmin
          .from('employees')
          .select('id, first_name, last_name, department, date_of_joining')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .gte('date_of_joining', weekAgo)
          .lte('date_of_joining', todayStr),
        supabaseAdmin
          .from('employees')
          .select('id, first_name, last_name, department, updated_at')
          .eq('company_id', companyId)
          .eq('is_active', false)
          .gte('updated_at', moment().tz(TIMEZONE).subtract(7, 'days').toISOString()),
        supabaseAdmin
          .from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('is_active', true),
        // HR only — see emailRecipients.service.js.
        getHrEmailRecipients(companyId),
      ]);

      const joiners = (joinersRes.data || []).map((e) => ({
        name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        department: e.department || '',
        date: e.date_of_joining,
      }));
      const exits = (exitsRes.data || []).map((e) => ({
        name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
        department: e.department || '',
        date: e.updated_at ? e.updated_at.slice(0, 10) : todayStr,
      }));
      const headcount = headcountRes.count ?? null;

      if (!joiners.length && !exits.length) continue;

      for (const recipient of recipients) {
        if (!recipient.email) continue;
        try {
          await joinerDigestEmail(recipient, weekLabel, { joiners, exits, headcount });
          summary.sent += 1;
        } catch (err) {
          summary.errors += 1;
          logger.warn('[WeeklyDigest] Joiner digest email failed', {
            companyId, recipientId: recipient.id, error: err.message,
          });
        }
      }
    }
  } catch (err) {
    summary.errors += 1;
    logger.error('[WeeklyDigest] Joiner digest failed', { reason, error: err.message });
    await alertOnCronFailure('digest_joiners', err.message).catch((e) =>
      logger.error('[CRON] alertOnCronFailure failed', { job: 'digest_joiners', error: e.message }));
  }

  logger.info('[WeeklyDigest] Joiner digest completed', summary);
  return summary;
});

// There is no recurring "leave balance low" reminder. It emailed every
// employee every Monday, and anyone with a leave type allocated 0 days (Earned
// Leave before it accrues, WFH, Comp Off, Unpaid…) was told that balance was
// "running low" every single week. The only low-balance email now is the
// one-off notice when an approved leave actually brings a real balance down
// (leave.service.js notifyLeaveApproved).

const startWeeklyDigestCrons = () => {
  // Pending approvals: daily at 8:30 AM
  cron.schedule('30 8 * * *', () => runPendingApprovalsDigest('cron').catch(() => {}), { timezone: config.timezone });
  // Joiner digest: Mondays at 9 AM
  cron.schedule('0 9 * * 1', () => runJoinerDigest('cron').catch(() => {}), { timezone: config.timezone });

  logger.info(`Weekly digest crons scheduled (pending approvals: daily 8:30AM, joiner digest: Mondays) ${config.timezone}`);
};

module.exports = {
  startWeeklyDigestCrons,
  runPendingApprovalsDigest,
  runJoinerDigest,
};
