const cron = require('node-cron');
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const {
  pendingApprovalsDigestEmail,
  joinerDigestEmail,
  leaveBalanceLowEmail,
} = require('../services/email.service');
const emailPreferencesService = require('../services/emailPreferences.service');
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

      // HR and Admin employees who receive the digest
      const { data: recipients, error: recipientsError } = await supabaseAdmin
        .from('employees')
        .select('id, first_name, last_name, email')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .in('role', ['hr', 'admin']);

      if (recipientsError) {
        logger.warn('[WeeklyDigest] Recipients query failed', { companyId, error: recipientsError.message });
        summary.errors += 1;
        continue;
      }

      if (!recipients || !recipients.length) continue;

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

      const [joinersRes, exitsRes, headcountRes, recipientsRes] = await Promise.all([
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
        supabaseAdmin
          .from('employees')
          .select('id, first_name, last_name, email')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .in('role', ['hr', 'admin']),
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
      const recipients = recipientsRes.data || [];

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

/**
 * FIX 6F — Leave balance low alert: weekly (Monday 8AM).
 * Emails each active employee whose remaining balance for any leave type is below threshold.
 * Threshold: 3 days (remaining = total_allocated - used - encashed).
 */
const BALANCE_LOW_THRESHOLD = parseInt(process.env.LEAVE_LOW_THRESHOLD ?? '3', 10);

const runLeaveBalanceLowCheck = withCronLock('digest_leave_balance_low', 10 * 60 * 1000, async (reason = 'cron') => {
  const year = moment().tz(TIMEZONE).year();
  const summary = { reason, year, sent: 0, skipped: 0, errors: 0 };

  try {
    const tenantService = require('../services/tenant.service');
    const companies = await tenantService.listActiveCompanies();

    for (const company of companies || []) {
      const companyId = String(company.id);
      if (!await emailPreferencesService.isEmailEnabled(companyId, 'leave_balance_low')) {
        summary.skipped += 1;
        continue;
      }

      const { data: balances, error: balancesError } = await supabaseAdmin
        .from('leave_balances')
        .select('employee_id, leave_type, total_allocated, used, encashed, employee:employee_id(id, first_name, last_name, email, company_id, is_active)')
        .eq('year', year);

      if (balancesError) {
        logger.warn('[WeeklyDigest] Leave balances query failed', { companyId, error: balancesError.message });
        summary.errors += 1;
        continue;
      }

      // Group by employee, filter to company and active
      const byEmployee = new Map();
      for (const b of balances || []) {
        const emp = b.employee;
        if (!emp || !emp.is_active) continue;
        if (String(emp.company_id || DEFAULT_COMPANY_ID) !== companyId) continue;
        if (!emp.email) continue;

        const remaining = Number(b.total_allocated || 0) - Number(b.used || 0) - Number(b.encashed || 0);
        if (remaining > BALANCE_LOW_THRESHOLD) continue;

        if (!byEmployee.has(emp.id)) byEmployee.set(emp.id, { emp, lowBalances: [] });
        byEmployee.get(emp.id).lowBalances.push({
          leaveType: b.leave_type,
          remaining,
        });
      }

      for (const { emp, lowBalances } of byEmployee.values()) {
        if (!lowBalances.length) continue;
        // Send one email per employee — primary type is the lowest balance
        const sorted = [...lowBalances].sort((a, b) => a.remaining - b.remaining);
        const primary = sorted[0];
        const otherBalances = sorted.slice(1).map((lb) => ({ type: lb.leaveType, remaining: lb.remaining }));
        try {
          await leaveBalanceLowEmail(emp, {
            leaveType: primary.leaveType,
            remaining: primary.remaining,
            threshold: BALANCE_LOW_THRESHOLD,
            otherBalances,
          });
          summary.sent += 1;
        } catch (err) {
          summary.errors += 1;
          logger.warn('[WeeklyDigest] Leave balance low email failed', {
            companyId, employeeId: emp.id, error: err.message,
          });
        }
      }
    }
  } catch (err) {
    summary.errors += 1;
    logger.error('[WeeklyDigest] Leave balance low check failed', { reason, error: err.message });
    await alertOnCronFailure('digest_leave_balance_low', err.message).catch((e) =>
      logger.error('[CRON] alertOnCronFailure failed', { job: 'digest_leave_balance_low', error: e.message }));
  }

  logger.info('[WeeklyDigest] Leave balance low check completed', summary);
  return summary;
});

const startWeeklyDigestCrons = () => {
  // Pending approvals: daily at 8:30 AM
  cron.schedule('30 8 * * *', () => runPendingApprovalsDigest('cron').catch(() => {}), { timezone: config.timezone });
  // Joiner digest: Mondays at 9 AM
  cron.schedule('0 9 * * 1', () => runJoinerDigest('cron').catch(() => {}), { timezone: config.timezone });
  // Leave balance low: Mondays at 8 AM
  cron.schedule('0 8 * * 1', () => runLeaveBalanceLowCheck('cron').catch(() => {}), { timezone: config.timezone });

  logger.info(`Weekly digest crons scheduled (pending approvals: daily 8:30AM, joiner digest + leave balance: Mondays) ${config.timezone}`);
};

module.exports = {
  startWeeklyDigestCrons,
  runPendingApprovalsDigest,
  runJoinerDigest,
  runLeaveBalanceLowCheck,
};
