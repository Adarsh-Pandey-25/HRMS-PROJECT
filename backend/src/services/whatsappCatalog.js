const moment = require('moment-timezone');
const F = require('./whatsappFormat');
const L = require('./whatsappLookup');

/**
 * Which WhatsApp message every email and every in-app notification becomes.
 *
 * EMAIL_RULES has one entry per email type in emailCatalog.js — a rule, or
 * `never` with the reason it must not go to WhatsApp (passwords, codes,
 * people who are not users). A test fails if an email type is missing, so a
 * new email cannot quietly skip WhatsApp.
 *
 * A rule's event() turns the email's own arguments into:
 *   key      what happened — the same key from the email and from the in-app
 *            notification of one event, so the person gets ONE message
 *   record   the record it is about (with key and person: the dedupe key)
 *   to       { employees: [ids] } | { email: { companyId, address } } | { superAdmins: true }
 *   values   ({ person, company }) => the template's blanks, in order
 *
 * Values are short and never sensitive: no amounts, reasons, passwords,
 * codes, IPs or contact details — the message says what happened and points
 * to SpaxSync for the rest.
 */

const NEVER_REASONS = {
  credentials: 'Carries a password',
  secret_code: 'Carries a secret code',
  not_connected_yet: 'The person cannot have connected WhatsApp before their first sign-in',
  not_a_user: 'Goes to someone who is not a SpaxSync user and has not agreed to WhatsApp messages',
  covered_by_in_app: 'The in-app notification it copies sends the WhatsApp message itself',
};

const never = (reason) => ({ never: reason });
const today = () => moment().tz(F.DEFAULT_TIMEZONE).format('YYYY-MM-DD');
const hourBucket = () => moment().tz(F.DEFAULT_TIMEZONE).format('YYYY-MM-DD-HH');
const toEmployee = (row) => ({ employees: row?.id ? [row.id] : [] });
const toEmail = (companyId, address) => ({ email: { companyId, address } });
const SUPER_ADMINS = { superAdmins: true };

/** Runs a lookup once per event, however many people it fans out to. */
const once = (fn) => {
  let promise = null;
  return () => {
    if (!promise) promise = Promise.resolve().then(fn);
    return promise;
  };
};

/** 8 · 2.5 */
const days = (n) => (Number.isFinite(Number(n)) ? String(Number(n)) : '—');

/** 42 minutes · 1h 5m */
const lateBy = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  return F.formatHours(m / 60);
};

const payslipRecord = (month, year) => `${year}-${String(month).padStart(2, '0')}`;

const leaveWhat = async (companyId, leave) => (leave
  ? `${await L.leaveTypeName(companyId, leave.leave_type)} for ${F.formatDateRange(leave.from_date, leave.to_date)}`
  : 'a leave request');

/** A "general update" email for things that only need a one-line heads-up. */
const general = (key, group, text) => ({
  template: 'general_update',
  group,
  event: ([recipient]) => ({
    key,
    record: today(),
    to: toEmployee(recipient),
    values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), text],
  }),
});

/** Billing emails go to company admins addressed as { to, name }. */
const billing = (key, describe, recordOf = () => '') => ({
  template: 'billing_update',
  group: 'billing',
  event: ([recipient, subscription, ...rest]) => ({
    key,
    record: `${subscription?.id}:${recordOf(subscription, ...rest) || subscription?.current_period_end || today()}`,
    to: toEmail(subscription?.company_id || subscription?.companies?.id, recipient?.to),
    values: async ({ person, company }) => [
      F.firstName(person?.first_name ? person : { name: recipient?.name }),
      await L.companyName(company),
      describe(subscription, ...rest),
    ],
  }),
});

/** Beacon alerts go to HR and admins addressed as { to, name }. */
const beacon = (key, describe, perHour = true) => ({
  template: 'security_alert',
  group: 'security',
  event: ([recipient, beaconRow]) => ({
    key,
    record: perHour ? `${beaconRow?.id}:${hourBucket()}` : String(beaconRow?.id),
    to: toEmail(beaconRow?.company_id, recipient?.to),
    values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), describe(beaconRow)],
  }),
});

const EMAIL_RULES = {
  // ── Never on WhatsApp ──────────────────────────────────────────────────
  welcome: never('credentials'),
  onboarding_invite: never('credentials'),
  bulk_import: never('credentials'),
  day_one: never('credentials'),
  password_reset: never('secret_code'),
  onboarding_otp: never('secret_code'),
  prejoining: never('not_connected_yet'),
  offer_letter: never('not_a_user'),
  company_invite: never('not_a_user'),
  lead_confirmation: never('not_a_user'),
  notification: never('covered_by_in_app'),

  // ── Leave ──────────────────────────────────────────────────────────────
  leave_applied: {
    template: 'leave_request_sent',
    group: 'leave',
    event: ([employee, leave]) => ({
      key: 'leave_request_sent',
      record: leave?.id,
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person),
        await L.leaveTypeName(company.id, leave?.leave_type),
        F.formatDateRange(leave?.from_date, leave?.to_date),
        await L.companyName(company),
      ],
    }),
  },
  leave_approval_request: {
    template: 'approval_waiting',
    group: 'leave',
    event: ([manager, employee, leave]) => ({
      key: 'leave_approval_waiting',
      record: leave?.id,
      to: toEmployee(manager),
      values: async ({ person, company }) => [
        F.firstName(person), F.fullName(employee), await L.companyName(company), await leaveWhat(company.id, leave),
      ],
    }),
  },
  leave_approved: {
    template: 'leave_approved',
    group: 'leave',
    event: ([employee, leave, opts = {}]) => ({
      key: 'leave_approved',
      record: leave?.id,
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person),
        await L.leaveTypeName(company.id, leave?.leave_type),
        F.formatDateRange(leave?.from_date, leave?.to_date),
        opts.approverName || (await L.employeeName(leave?.approved_by)) || 'your approver',
        await L.companyName(company),
      ],
    }),
  },
  leave_rejected: {
    template: 'leave_not_approved',
    group: 'leave',
    event: ([employee, leave, opts = {}]) => ({
      key: 'leave_not_approved',
      record: leave?.id,
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person),
        await L.leaveTypeName(company.id, leave?.leave_type),
        F.formatDateRange(leave?.from_date, leave?.to_date),
        opts.approverName || (await L.employeeName(leave?.approved_by)) || 'your approver',
        await L.companyName(company),
      ],
    }),
  },
  leave_balance_changed: {
    template: 'leave_balance_updated',
    group: 'leave',
    event: ([employee, changes]) => {
      const list = Array.isArray(changes) ? changes : [];
      const record = `${today()}:${L.idsKey(list.map((c) => `${c?.code || c?.name}:${c?.to}`))}`;
      if (list.length === 1) {
        const c = list[0];
        return {
          key: 'leave_balance_updated',
          record,
          to: toEmployee(employee),
          values: async ({ person, company }) => [
            F.firstName(person),
            c?.name || (await L.leaveTypeName(company.id, c?.code)),
            await L.companyName(company),
            days(c?.available ?? c?.to),
          ],
        };
      }
      return {
        key: 'leave_balance_updated',
        record,
        to: toEmployee(employee),
        template: 'general_update',
        values: async ({ person, company }) => [
          F.firstName(person), await L.companyName(company), `HR updated ${list.length} of your leave balances`,
        ],
      };
    },
  },
  leave_balance_changed_admin: {
    template: 'leave_balance_changed_admin',
    group: 'leave',
    event: ([admin, employee, changes]) => {
      const list = Array.isArray(changes) ? changes : [];
      const record = `${employee?.id}:${today()}:${L.idsKey(list.map((c) => `${c?.code || c?.name}:${c?.to}`))}`;
      if (list.length === 1) {
        const c = list[0];
        return {
          key: 'leave_balance_changed_admin',
          record,
          to: toEmployee(admin),
          values: async ({ person, company }) => [
            F.firstName(person),
            c?.name || (await L.leaveTypeName(company.id, c?.code)),
            F.fullName(employee),
            await L.companyName(company),
            days(c?.from),
            days(c?.to),
          ],
        };
      }
      return {
        key: 'leave_balance_changed_admin',
        record,
        to: toEmployee(admin),
        template: 'general_update',
        values: async ({ person, company }) => [
          F.firstName(person), await L.companyName(company), `Leave balances of ${F.fullName(employee)} were updated`,
        ],
      };
    },
  },
  leave_balance_low: {
    template: 'leave_balance_low',
    group: 'leave',
    event: ([employee, opts = {}]) => ({
      key: 'leave_balance_low',
      record: `${opts.leaveType}:${today()}`,
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person), days(opts.remaining), await L.leaveTypeName(company.id, opts.leaveType), await L.companyName(company),
      ],
    }),
  },

  // ── Attendance ─────────────────────────────────────────────────────────
  attendance_absent_alert: {
    template: 'attendance_absent',
    group: 'attendance',
    event: ([employee, dateLabel]) => ({
      key: 'attendance_absent',
      record: String(dateLabel),
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), dateLabel, await L.companyName(company)],
    }),
  },
  attendance_late_alert: {
    template: 'attendance_late',
    group: 'attendance',
    event: ([employee, dateLabel, minutesLate]) => ({
      key: 'attendance_late',
      record: String(dateLabel),
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), lateBy(minutesLate), dateLabel, await L.companyName(company)],
    }),
  },
  attendance_short_hours_alert: {
    template: 'attendance_short_hours',
    group: 'attendance',
    event: ([employee, dateLabel, workedHours, expectedHours]) => ({
      key: 'attendance_short_hours',
      record: String(dateLabel),
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person), F.formatHours(workedHours), dateLabel, await L.companyName(company), F.formatHours(expectedHours),
      ],
    }),
  },
  attendance_anomaly_digest: {
    template: 'attendance_summary',
    group: 'summaries',
    event: ([recipient, dateLabel, anomalies]) => {
      const list = Array.isArray(anomalies) ? anomalies : [];
      const count = (pattern) => String(list.filter((a) => pattern.test(String(a?.type || ''))).length);
      return {
        key: 'attendance_summary',
        record: String(dateLabel),
        to: toEmployee(recipient),
        values: async ({ person, company }) => [
          F.firstName(person), await L.companyName(company), dateLabel, count(/absent/i), count(/late/i), count(/short/i),
        ],
      };
    },
  },
  auto_checkout: {
    template: 'auto_checkout',
    group: 'attendance',
    event: ([employee, attendance]) => {
      const date = F.formatDate(attendance?.check_in_time || attendance?.date);
      return {
        key: 'auto_checkout',
        record: attendance?.id || date,
        to: toEmployee(employee),
        values: async ({ person, company }) => [F.firstName(person), date, await L.companyName(company)],
      };
    },
  },
  regularization_approved: {
    template: 'attendance_correction_update',
    group: 'attendance',
    event: ([employee, opts = {}]) => ({
      key: 'attendance_correction_update',
      record: `${opts.dateLabel}:approved`,
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person), opts.dateLabel || 'the requested day', await L.companyName(company), 'approved',
      ],
    }),
  },
  regularization_rejected: {
    template: 'attendance_correction_update',
    group: 'attendance',
    event: ([employee, opts = {}]) => ({
      key: 'attendance_correction_update',
      record: `${opts.dateLabel}:rejected`,
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person), opts.dateLabel || 'the requested day', await L.companyName(company), 'not approved',
      ],
    }),
  },

  // ── Payroll (never amounts) ────────────────────────────────────────────
  payslip: {
    template: 'payslip_ready',
    group: 'payroll',
    event: ([employee, payroll]) => ({
      key: 'payslip_ready',
      record: payslipRecord(payroll?.month, payroll?.year),
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person), F.formatMonth(payroll?.month, payroll?.year), await L.companyName(company),
      ],
    }),
  },
  salary_revised: {
    template: 'salary_revised',
    group: 'payroll',
    event: ([employee, opts = {}]) => ({
      key: 'salary_revised',
      record: String(opts.effectiveDate || today()),
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), F.formatDate(opts.effectiveDate)],
    }),
  },
  payroll_setup_changed_admin: {
    template: 'payroll_setup_changed',
    group: 'payroll',
    event: ([admin, employee, changes]) => {
      const labels = [...new Set((Array.isArray(changes) ? changes : []).map((c) => c?.label).filter(Boolean))];
      const what = labels.length
        ? `${labels.slice(0, 3).join(', ')} ${labels.length === 1 ? 'setting' : 'settings'} updated`
        : 'settings updated';
      return {
        key: 'payroll_setup_changed',
        record: `${employee?.id}:${hourBucket()}:${L.idsKey(labels)}`,
        to: toEmployee(admin),
        values: async ({ person, company }) => [F.firstName(person), F.fullName(employee), await L.companyName(company), what],
      };
    },
  },
  payslip_failed: {
    template: 'general_update',
    group: 'payroll',
    event: ([recipient, label]) => ({
      key: 'payslip_failed',
      record: String(label || today()),
      to: toEmployee(recipient),
      values: async ({ person, company }) => [
        F.firstName(person), await L.companyName(company), `Some payslips for ${label || 'this month'} could not be generated`,
      ],
    }),
  },

  // ── HR summaries ───────────────────────────────────────────────────────
  pending_approvals_digest: {
    template: 'approvals_summary',
    group: 'summaries',
    event: ([recipient, , groups]) => {
      const total = (Array.isArray(groups) ? groups : [])
        .reduce((n, g) => n + (Array.isArray(g?.items) ? g.items.length : 0), 0);
      if (!total) return null;
      return {
        key: 'approvals_summary',
        record: today(),
        to: toEmployee(recipient),
        values: async ({ person, company }) => [F.firstName(person), String(total), await L.companyName(company)],
      };
    },
  },
  joiner_digest: {
    template: 'people_summary',
    group: 'summaries',
    event: ([recipient, weekLabel, data = {}]) => ({
      key: 'people_summary',
      record: String(weekLabel || today()),
      to: toEmployee(recipient),
      values: async ({ person, company }) => [
        F.firstName(person),
        await L.companyName(company),
        String((data?.joiners || []).length),
        String((data?.exits || []).length),
        days(data?.headcount),
      ],
    }),
  },

  // ── Recruitment (to HR; never the offer itself) ───────────────────────
  offer_accepted: {
    template: 'offer_response',
    group: 'recruitment',
    event: ([recipient, candidate, opts = {}]) => ({
      key: 'offer_response',
      record: `${candidate?.id}:accepted`,
      to: toEmployee(recipient),
      values: async ({ person, company }) => [
        F.firstName(person), F.clean(candidate?.name, { max: 50, fallback: 'A candidate' }), 'accepted',
        F.clean(opts.role, { max: 50, fallback: 'the role' }), await L.companyName(company),
      ],
    }),
  },
  offer_rejected: {
    template: 'offer_response',
    group: 'recruitment',
    event: ([recipient, candidate, opts = {}]) => ({
      key: 'offer_response',
      record: `${candidate?.id}:declined`,
      to: toEmployee(recipient),
      values: async ({ person, company }) => [
        F.firstName(person), F.clean(candidate?.name, { max: 50, fallback: 'A candidate' }), 'declined',
        F.clean(opts.role, { max: 50, fallback: 'the role' }), await L.companyName(company),
      ],
    }),
  },

  // ── Account, onboarding and exit ───────────────────────────────────────
  account_deactivated: {
    template: 'account_deactivated',
    group: 'account',
    event: ([employee]) => ({
      key: 'account_deactivated',
      record: today(),
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), await L.companyName(company)],
    }),
  },
  // Not sent by anything yet (emailCatalog.js live:false) — ready for when they are.
  checklist_reminder: general('checklist_reminder', 'requests', 'Your onboarding checklist has pending items'),
  onboarding_complete: general('onboarding_complete', 'requests', 'Your onboarding is complete'),
  offboarding_initiated: general('offboarding_initiated', 'account', 'Your exit process has started'),
  exit_checklist: general('exit_checklist', 'account', 'Your exit checklist is ready'),
  final_settlement: general('final_settlement', 'account', 'Your final settlement has been processed'),
  training_assignment: {
    template: 'general_update',
    group: 'requests',
    event: ([employee, training]) => ({
      key: 'training_assignment',
      record: training?.id || today(),
      to: toEmployee(employee),
      values: async ({ person, company }) => [
        F.firstName(person), await L.companyName(company), `New training assigned: ${F.clean(training?.title, { max: 50 })}`,
      ],
    }),
  },

  // ── Company news and celebrations (marketing) ─────────────────────────
  announcement: {
    template: 'company_announcement',
    group: 'company_news',
    event: ([employee, announcement]) => ({
      key: 'company_announcement',
      record: announcement?.id,
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), F.quoted(announcement?.title)],
    }),
  },
  holiday_list: {
    template: 'holiday_list',
    group: 'company_news',
    event: ([employee, holidays]) => {
      const list = Array.isArray(holidays) ? holidays : [];
      return {
        key: 'holiday_list',
        record: L.idsKey(list.map((h) => h?.id)),
        to: toEmployee(employee),
        values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), L.yearsOf(list.map((h) => h?.date))],
      };
    },
  },
  birthday_wish: {
    template: 'birthday_wish',
    group: 'my_celebrations',
    event: ([employee]) => ({
      key: 'birthday_wish',
      record: today(),
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), await L.companyName(company)],
    }),
  },
  work_anniversary: {
    template: 'work_anniversary',
    group: 'my_celebrations',
    event: ([employee, years]) => ({
      key: 'work_anniversary',
      record: today(),
      to: toEmployee(employee),
      values: async ({ person, company }) => [F.firstName(person), F.formatYears(years), await L.companyName(company)],
    }),
  },

  // ── Security (to HR and admins) ────────────────────────────────────────
  api_key_created: {
    template: 'security_alert',
    group: 'security',
    event: ([recipient, opts = {}]) => ({
      key: 'api_key_created',
      record: `${opts.keyName}:${hourBucket()}`,
      to: toEmployee(recipient),
      values: async ({ person, company }) => [
        F.firstName(person),
        await L.companyName(company),
        `a new API key ${F.quoted(opts.keyName, 40)} was created${opts.createdByName ? ` by ${F.clean(opts.createdByName, { max: 40 })}` : ''}`,
      ],
    }),
  },
  api_key_revoked: {
    template: 'security_alert',
    group: 'security',
    event: ([recipient, opts = {}]) => ({
      key: 'api_key_revoked',
      record: `${opts.keyName}:${hourBucket()}`,
      to: toEmployee(recipient),
      values: async ({ person, company }) => [
        F.firstName(person),
        await L.companyName(company),
        `the API key ${F.quoted(opts.keyName, 40)} was revoked${opts.revokedByName ? ` by ${F.clean(opts.revokedByName, { max: 40 })}` : ''}`,
      ],
    }),
  },
  beacon_first_ping: beacon('beacon_first_ping', (b) => `office beacon ${F.quoted(b?.label, 40)} reported in for the first time`, false),
  beacon_compromise_alert: beacon('beacon_compromise_alert', (b) => `office beacon ${F.quoted(b?.label, 40)} changed its IP address unusually often`),
  beacon_geo_mismatch: beacon('beacon_geo_mismatch', (b) => `office beacon ${F.quoted(b?.label, 40)} reported from an unexpected location`),

  // ── Billing (to company admins) ────────────────────────────────────────
  subscription_welcome: billing('subscription_welcome', (s, plan) => `your ${plan?.name ? `${F.clean(plan.name, { max: 30 })} ` : ''}plan is now active`),
  subscription_renewed: billing('subscription_renewed', (s) => `your subscription has renewed until ${F.formatDate(s?.current_period_end)}`),
  subscription_plan_changed: billing(
    'subscription_plan_changed',
    (s, oldPlan, newPlan) => `your plan changed from ${F.clean(oldPlan?.name, { max: 30, fallback: 'the old plan' })} to ${F.clean(newPlan?.name, { max: 30, fallback: 'a new plan' })}`,
    () => hourBucket(),
  ),
  subscription_renewal_reminder: billing(
    'subscription_renewal_reminder',
    (s) => `your subscription renews on ${F.formatDate(s?.current_period_end)}`,
    (s, plan, price, notificationType) => `${notificationType}:${s?.current_period_end}`,
  ),
  subscription_payment_failed: billing('subscription_payment_failed', () => 'your payment did not go through', () => today()),
  subscription_grace_period_ending: billing(
    'subscription_grace_period_ending',
    (s, daysLeft) => `your payment grace period ends in ${days(daysLeft)} day${Number(daysLeft) === 1 ? '' : 's'}`,
    (s, daysLeft) => `${daysLeft}`,
  ),
  subscription_suspended: billing('subscription_suspended', () => 'your subscription has been suspended for non-payment', () => today()),
  subscription_trial_ending: billing('subscription_trial_ending', (s) => `your free trial ends on ${F.formatDate(s?.current_period_end)}`),
  subscription_trial_ended: billing('subscription_trial_ended', () => 'your free trial has ended'),

  // ── Platform (to super admins who connected) ──────────────────────────
  lead_notification: {
    template: 'platform_alert',
    group: 'platform',
    event: ([, lead]) => ({
      key: 'lead_notification',
      record: lead?.id || hourBucket(),
      to: SUPER_ADMINS,
      values: async () => [
        `new ${F.clean(lead?.type, { max: 20, fallback: 'trial' })} enquiry from ${F.clean(lead?.company_name, { max: 50, fallback: 'a company' })}`,
      ],
    }),
  },
};

/**
 * Platform alerts sent with sendEmail({ type }) directly rather than through
 * a template. Their subject is a short, non-sensitive summary ("Scheduled job
 * failed: autoPayroll") — used as the message when present.
 */
const DIRECT_EMAIL_RULES = {
  cron_failure_alert: 'a background job failed',
  adms_unauthorized_alert: 'an unknown biometric device tried to connect',
  adms_save_failure_alert: 'biometric punches are failing to save',
  billing_alert: 'the billing job hit a problem',
};

const directEmailEvent = ({ type, subject } = {}) => {
  const fallback = DIRECT_EMAIL_RULES[type];
  if (!fallback) return null;
  const summary = F.clean(String(subject || '').replace(/^\s*\[[^\]]*\]\s*/, ''), { max: 120, fallback });
  return {
    template: 'platform_alert',
    group: 'platform',
    key: type,
    record: `${hourBucket()}:${L.idsKey([summary])}`,
    to: SUPER_ADMINS,
    values: async () => [summary],
  };
};

/**
 * The WhatsApp message(s) an in-app notification row becomes — usually one;
 * a "birthday and work anniversary" notice becomes two; a few become none
 * because a dedicated email already covers them (attendance-correction
 * tickets). `item` is the inserted notifications row.
 */
const notificationEvents = async (item) => {
  const type = String(item?.type || '').toUpperCase();
  const title = String(item?.title || '');
  const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {};
  const to = { employees: item?.user_id ? [item.user_id] : [] };
  const rowRecord = item?.id || `${Date.now()}`;
  const event = (fields) => ({ to, ...fields });

  switch (type) {
    case 'LEAVE': {
      const leave = once(() => L.leave(meta.leave_id));
      const requester = once(async () => L.employeeName((await leave())?.employee_id));
      if (/needs hr approval/i.test(title)) {
        return [event({
          key: 'leave_hr_approval_waiting', record: meta.leave_id, template: 'approval_waiting', group: 'leave',
          values: async ({ person, company }) => [
            F.firstName(person), (await requester()) || 'A colleague', await L.companyName(company),
            `${await leaveWhat(company.id, await leave())} (approved by their manager)`,
          ],
        })];
      }
      if (/pending approval|submitted/i.test(title)) {
        return [event({
          key: 'leave_approval_waiting', record: meta.leave_id, template: 'approval_waiting', group: 'leave',
          values: async ({ person, company }) => [
            F.firstName(person), (await requester()) || 'A colleague', await L.companyName(company), await leaveWhat(company.id, await leave()),
          ],
        })];
      }
      const approved = /approved/i.test(title);
      if (approved || /rejected/i.test(title)) {
        return [event({
          key: approved ? 'leave_approved' : 'leave_not_approved',
          record: meta.leave_id,
          template: approved ? 'leave_approved' : 'leave_not_approved',
          group: 'leave',
          values: async ({ person, company }) => {
            const lv = await leave();
            return [
              F.firstName(person),
              await L.leaveTypeName(company.id, lv?.leave_type),
              F.formatDateRange(lv?.from_date, lv?.to_date),
              (await L.employeeName(lv?.approved_by)) || 'your approver',
              await L.companyName(company),
            ];
          },
        })];
      }
      break;
    }

    case 'ATTENDANCE': {
      if (/wfh request pending/i.test(title)) {
        const daysOf = once(() => L.wfhDays({ batchId: meta.wfh_batch_id }));
        return [event({
          key: 'wfh_approval_waiting', record: meta.wfh_batch_id || meta.work_date || rowRecord, template: 'approval_waiting', group: 'requests',
          values: async ({ person, company }) => {
            const rows = await daysOf();
            const dates = (Array.isArray(meta.work_dates) && meta.work_dates.length ? meta.work_dates : rows.map((r) => r.work_date))
              .filter(Boolean).sort();
            return [
              F.firstName(person),
              (await L.employeeName(rows[0]?.employee_id)) || 'A colleague',
              await L.companyName(company),
              `work from home for ${F.formatDateRange(dates[0] || meta.work_date, dates[dates.length - 1] || meta.work_date)}`,
            ];
          },
        })];
      }
      if (/wfh (approved|rejected)/i.test(title)) {
        const ok = /approved/i.test(title);
        return [event({
          key: 'wfh_decided', record: `${meta.wfh_request_id || rowRecord}:${ok ? 'approved' : 'rejected'}`, template: 'wfh_update', group: 'requests',
          values: async ({ person, company }) => {
            const rows = await L.wfhDays({ requestId: meta.wfh_request_id });
            const dates = rows.map((r) => r.work_date).filter(Boolean).sort();
            return [
              F.firstName(person),
              F.formatDateRange(dates[0] || meta.work_date, dates[dates.length - 1] || meta.work_date),
              await L.companyName(company),
              ok ? 'approved' : 'not approved',
            ];
          },
        })];
      }
      break;
    }

    case 'PAYROLL':
      return [event({
        key: 'payslip_ready', record: payslipRecord(meta.month, meta.year), template: 'payslip_ready', group: 'payroll',
        values: async ({ person, company }) => [F.firstName(person), F.formatMonth(meta.month, meta.year), await L.companyName(company)],
      })];

    case 'TRAINING':
      return [event({
        key: 'training_overdue', record: rowRecord, template: 'training_overdue', group: 'requests',
        values: async ({ person, company }) => [F.firstName(person), F.quoted('onboarding training'), await L.companyName(company)],
      })];

    case 'BIRTHDAY':
    case 'ANNIVERSARY': {
      const isBirthday = meta.is_birthday ?? type === 'BIRTHDAY';
      const isAnniversary = meta.is_anniversary ?? type === 'ANNIVERSARY';
      const events = [];
      if (meta.celebrant_id) {
        // Everyone else in the company: "today is Priya's birthday".
        const name = F.clean(meta.celebrant_name, { max: 50, fallback: 'a colleague' });
        if (isBirthday) {
          events.push(event({
            key: 'team_birthday', record: `${meta.celebrant_id}:${today()}`, template: 'team_birthday', group: 'team_celebrations',
            values: async ({ person, company }) => [F.firstName(person), name, await L.companyName(company)],
          }));
        }
        if (isAnniversary) {
          events.push(event({
            key: 'team_anniversary', record: `${meta.celebrant_id}:${today()}`, template: 'team_anniversary', group: 'team_celebrations',
            values: async ({ person, company }) => [F.firstName(person), name, F.formatYears(meta.years_of_service), await L.companyName(company)],
          }));
        }
        return events;
      }
      // The person celebrating — the same key as the birthday/anniversary email.
      if (isBirthday) {
        events.push(event({
          key: 'birthday_wish', record: today(), template: 'birthday_wish', group: 'my_celebrations',
          values: async ({ person, company }) => [F.firstName(person), await L.companyName(company)],
        }));
      }
      if (isAnniversary) {
        events.push(event({
          key: 'work_anniversary', record: today(), template: 'work_anniversary', group: 'my_celebrations',
          values: async ({ person, company }) => [F.firstName(person), F.formatYears(meta.years_of_service), await L.companyName(company)],
        }));
      }
      return events;
    }

    case 'ANNOUNCEMENT':
      return [event({
        key: 'company_announcement', record: meta.announcement_id || rowRecord, template: 'company_announcement', group: 'company_news',
        values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), F.quoted(item.message)],
      })];

    case 'HOLIDAY': {
      const ids = Array.isArray(meta.holiday_ids) ? meta.holiday_ids : [];
      const years = once(() => L.holidayYears(ids));
      return [event({
        key: 'holiday_list', record: ids.length ? L.idsKey(ids) : rowRecord, template: 'holiday_list', group: 'company_news',
        values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), await years()],
      })];
    }

    case 'TICKET': {
      const ticket = await L.ticket(meta.ticket_id);
      const regularization = L.isRegularizationTicket(ticket);
      if (/new helpdesk ticket/i.test(title)) {
        const raiser = once(() => L.employeeName(ticket?.raised_by));
        if (regularization) {
          return [event({
            key: 'regularization_waiting', record: meta.ticket_id, template: 'approval_waiting', group: 'attendance',
            values: async ({ person, company }) => [
              F.firstName(person), (await raiser()) || 'A colleague', await L.companyName(company),
              `attendance correction for ${L.regularizationDate(ticket) || 'a past day'}`,
            ],
          })];
        }
        return [event({
          key: 'ticket_new', record: meta.ticket_id || rowRecord, template: 'ticket_new', group: 'requests',
          values: async ({ person, company }) => [
            F.firstName(person), (await raiser()) || 'A colleague', await L.companyName(company), F.quoted(ticket?.subject),
          ],
        })];
      }
      // Attendance corrections have their own approved / not approved message.
      if (regularization) return [];
      if (meta.status && /resolved|updated/i.test(title)) {
        return [event({
          key: 'ticket_update', record: `${meta.ticket_id}:${meta.status}`, template: 'ticket_update', group: 'requests',
          values: async ({ person, company }) => [
            F.firstName(person), F.quoted(ticket?.subject), await L.companyName(company), F.decisionWord(meta.status),
          ],
        })];
      }
      return [event({
        key: 'ticket_reply', record: rowRecord, template: 'ticket_reply', group: 'requests',
        values: async ({ person, company }) => [F.firstName(person), F.quoted(ticket?.subject), await L.companyName(company)],
      })];
    }

    case 'DOCUMENT': {
      const doc = once(() => L.documentInfo(meta.document_id));
      if (/pending verification/i.test(title)) {
        return [event({
          key: 'document_uploaded', record: meta.document_id || rowRecord, template: 'document_uploaded', group: 'requests',
          values: async ({ person, company }) => {
            const d = await doc();
            return [
              F.firstName(person),
              (await L.employeeName(meta.employee_id || d?.employee_id)) || 'A colleague',
              F.quoted(d?.label || 'document'),
              await L.companyName(company),
            ];
          },
        })];
      }
      if (/verified/i.test(title)) {
        return [event({
          key: 'document_verified', record: meta.document_id || rowRecord, template: 'document_verified', group: 'requests',
          values: async ({ person, company }) => [F.firstName(person), F.quoted((await doc())?.label || 'document'), await L.companyName(company), 'verified'],
        })];
      }
      break;
    }

    case 'REIMBURSEMENT': {
      const claim = once(() => L.reimbursement(meta.reimbursement_id));
      const requester = once(async () => L.employeeName(meta.employee_id || (await claim())?.employee_id));
      const hr = /needs hr approval/i.test(title);
      if (hr || /pending approval|submitted/i.test(title)) {
        return [event({
          key: hr ? 'expense_hr_approval_waiting' : 'expense_approval_waiting',
          record: meta.reimbursement_id || rowRecord,
          template: 'approval_waiting',
          group: 'requests',
          values: async ({ person, company }) => [
            F.firstName(person), (await requester()) || 'A colleague', await L.companyName(company),
            `an expense claim for ${String((await claim())?.label || 'expenses').toLowerCase()}${hr ? ' (approved by their manager)' : ''}`,
          ],
        })];
      }
      const ok = /approved/i.test(title);
      if (ok || /rejected/i.test(title)) {
        return [event({
          key: 'expense_decided', record: `${meta.reimbursement_id || rowRecord}:${ok ? 'approved' : 'rejected'}`, template: 'expense_update', group: 'requests',
          values: async ({ person, company }) => [
            F.firstName(person), F.quoted((await claim())?.label || 'Expense'), await L.companyName(company), ok ? 'approved' : 'not approved',
          ],
        })];
      }
      break;
    }

    default:
      break;
  }

  // Anything new or unrecognised still reaches the person, as a one-line update.
  return [event({
    key: `notification_${type.toLowerCase() || 'general'}`,
    record: rowRecord,
    template: 'general_update',
    group: 'requests',
    values: async ({ person, company }) => [F.firstName(person), await L.companyName(company), F.clean(title, { max: 60, fallback: 'New update' })],
  })];
};

/** The in-app notification types SpaxSync creates today (every one is mapped above). */
const KNOWN_NOTIFICATION_TYPES = [
  'LEAVE', 'ATTENDANCE', 'PAYROLL', 'TRAINING', 'BIRTHDAY', 'ANNIVERSARY',
  'ANNOUNCEMENT', 'HOLIDAY', 'TICKET', 'DOCUMENT', 'REIMBURSEMENT',
];

module.exports = {
  NEVER_REASONS,
  EMAIL_RULES,
  DIRECT_EMAIL_RULES,
  KNOWN_NOTIFICATION_TYPES,
  directEmailEvent,
  notificationEvents,
};
