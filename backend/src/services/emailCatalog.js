/**
 * The catalogue of every email this platform sends: who receives it, what
 * triggers it, and whether a company may switch it off.
 *
 * Every send goes through email.service.js's sendEmail with a `type` from
 * this file. That one choke point is what makes the super-admin Email Log
 * complete and the per-company switches enforceable — a type missing from
 * here is logged as 'untyped' and can never be switched off, so add new
 * emails here first.
 *
 * `preference` is the per-company switch that governs the email (several
 * emails can share one). `null` means it is always sent, for one of the
 * reasons in LOCK_REASONS — chiefly that it carries login credentials:
 * employee creation never returns the temporary password to HR (credentials
 * go by email only — employee.controller.js), so switching the welcome email
 * off would leave every new hire unable to ever sign in.
 *
 * `live: false` marks a template that exists but that nothing sends yet, so
 * the catalogue does not claim an email goes out when it does not.
 */

/** Who receives the email. */
const AUDIENCE = {
  employee: 'Employee',
  manager: "Employee's manager",
  hr: 'HR (falls back to company admin only if the company has no HR)',
  hr_admin: 'HR and company admin',
  company_admin: 'Company admin',
  candidate: 'Job candidate',
  prospect: 'Prospective customer',
  platform: 'SpaxSync super admin',
};

const LOCK_REASONS = {
  credentials: 'Carries login credentials — HR never sees the temporary password, so without this email the person can never sign in.',
  security: 'Security notice for the company account — must reach its admins.',
  billing: 'Billing notice the company is contractually owed.',
  platform: 'Platform email, not tied to a company.',
};

/** The per-company switches, in the order the super-admin screen shows them. */
const PREFERENCES = {
  // Onboarding
  prejoining_reminder: { group: 'Onboarding', label: 'Pre-joining reminder', description: 'Reminder to a new hire a few days before their joining date.' },
  day_one_welcome: { group: 'Onboarding', label: 'Day-one welcome', description: 'Morning of the joining date. Issues a fresh temporary password — when off, the password from the original invite stays valid instead.' },
  checklist_reminder: { group: 'Onboarding', label: 'Onboarding checklist reminder', description: 'Nudge about pending onboarding checklist items.' },
  onboarding_complete: { group: 'Onboarding', label: 'Onboarding complete', description: 'Sent when a new hire finishes their onboarding checklist.' },
  // Offboarding
  offboarding: { group: 'Offboarding', label: 'Offboarding emails', description: 'Exit initiated, exit checklist, final settlement and account-deactivated notices.' },
  // Attendance
  attendance_anomaly_alerts: { group: 'Attendance', label: 'Absent / late / short-hours alert', description: "Sent to the employee after the daily attendance check flags their day." },
  attendance_anomaly_digest: { group: 'Attendance', label: 'Daily attendance anomaly digest', description: "Summary of the day's absences and late arrivals, sent to HR." },
  auto_checkout: { group: 'Attendance', label: 'Auto check-out notice', description: 'Sent when the system closes a day the employee forgot to check out of.' },
  regularization: { group: 'Attendance', label: 'Regularization decision', description: 'Approved / rejected result of an attendance regularization request.' },
  // Leave
  leave_updates: { group: 'Leave', label: 'Leave status updates', description: 'To the employee when they apply, and when their leave is approved or rejected.' },
  leave_approval_requests: { group: 'Leave', label: 'Leave approval request', description: "To the employee's manager when leave needs their approval." },
  leave_balance_low: { group: 'Leave', label: 'Low leave balance', description: 'When an employee\'s leave balance drops below the threshold.' },
  // Payroll
  payslip: { group: 'Payroll', label: 'Payslip published', description: 'To the employee when their payslip is published.' },
  salary_revision: { group: 'Payroll', label: 'Salary revision', description: 'To the employee when a salary revision takes effect.' },
  payroll_alerts: { group: 'Payroll', label: 'Payroll failure alert', description: 'To HR when payslips fail to generate for some employees.' },
  // HR digests
  pending_approvals_digest: { group: 'HR digests', label: 'Pending approvals digest', description: 'Weekly list of approvals waiting on HR.' },
  joiner_digest: { group: 'HR digests', label: 'Joiners & exits digest', description: 'Weekly joiners, exits and headcount, sent to HR.' },
  // People
  birthday_wishes: { group: 'Celebrations', label: 'Birthday wishes', description: 'Birthday greeting to the employee.' },
  work_anniversary_wishes: { group: 'Celebrations', label: 'Work anniversary wishes', description: 'Work anniversary greeting to the employee.' },
  // Recruitment
  recruitment: { group: 'Recruitment', label: 'Recruitment emails', description: 'Offer letters to candidates, and offer accepted / rejected notices to HR.' },
  // Engagement
  announcements: { group: 'Engagement', label: 'Announcements', description: 'Company announcements sent by email.' },
  training: { group: 'Engagement', label: 'Training assignment', description: 'When a course is assigned to an employee.' },
  notification_copies: { group: 'Engagement', label: 'In-app notification copies', description: 'Email copy of in-app notifications (WFH, tickets, approvals, etc.).' },
};

const PREFERENCE_KEYS = Object.keys(PREFERENCES);

/**
 * key: stable id, logged in email_log.email_type.
 * companyScoped: the email belongs to one company, so its switch applies and
 *   the log records the company. Platform/prospect emails are not.
 */
const EMAIL_TYPES = [
  // ── Accounts & onboarding ────────────────────────────────────────────────
  { key: 'welcome', label: 'Welcome & login credentials', audience: 'employee', trigger: 'An employee account is created (single add, or company setup).', preference: null, lock: 'credentials', companyScoped: true },
  { key: 'onboarding_invite', label: 'Self-service onboarding invite', audience: 'employee', trigger: 'HR adds an employee with self-service onboarding on.', preference: null, lock: 'credentials', companyScoped: true },
  { key: 'bulk_import', label: 'Bulk-import account created', audience: 'employee', trigger: 'An employee is created through bulk import.', preference: null, lock: 'credentials', companyScoped: true },
  { key: 'password_reset', label: 'Password reset code', audience: 'employee', trigger: 'Someone requests a password reset.', preference: null, lock: 'credentials', companyScoped: true },
  { key: 'prejoining', label: 'Pre-joining reminder', audience: 'employee', trigger: 'Onboarding cron, a few days before the joining date.', preference: 'prejoining_reminder', companyScoped: true },
  { key: 'day_one', label: 'Day-one welcome', audience: 'employee', trigger: 'Onboarding cron, on the joining date.', preference: 'day_one_welcome', companyScoped: true },
  { key: 'checklist_reminder', label: 'Onboarding checklist reminder', audience: 'employee', trigger: 'Nothing sends this yet.', preference: 'checklist_reminder', companyScoped: true, live: false },
  { key: 'onboarding_complete', label: 'Onboarding complete', audience: 'employee', trigger: 'Nothing sends this yet.', preference: 'onboarding_complete', companyScoped: true, live: false },

  // ── Offboarding ──────────────────────────────────────────────────────────
  { key: 'offboarding_initiated', label: 'Exit initiated', audience: 'employee', trigger: 'Nothing sends this yet.', preference: 'offboarding', companyScoped: true, live: false },
  { key: 'exit_checklist', label: 'Exit checklist', audience: 'employee', trigger: 'Nothing sends this yet.', preference: 'offboarding', companyScoped: true, live: false },
  { key: 'final_settlement', label: 'Final settlement', audience: 'employee', trigger: 'Nothing sends this yet.', preference: 'offboarding', companyScoped: true, live: false },
  { key: 'account_deactivated', label: 'Account deactivated', audience: 'employee', trigger: 'HR deactivates or finishes offboarding an employee.', preference: 'offboarding', companyScoped: true },

  // ── Attendance ───────────────────────────────────────────────────────────
  { key: 'attendance_absent_alert', label: 'Absent alert', audience: 'employee', trigger: 'Daily attendance check finds no check-in for the day.', preference: 'attendance_anomaly_alerts', companyScoped: true },
  { key: 'attendance_late_alert', label: 'Late arrival alert', audience: 'employee', trigger: 'Daily attendance check finds a late check-in.', preference: 'attendance_anomaly_alerts', companyScoped: true },
  { key: 'attendance_short_hours_alert', label: 'Short hours alert', audience: 'employee', trigger: 'Daily attendance check finds fewer hours than expected.', preference: 'attendance_anomaly_alerts', companyScoped: true },
  { key: 'attendance_anomaly_digest', label: 'Attendance anomaly digest', audience: 'hr', trigger: "Daily attendance check, one summary of the day's flags.", preference: 'attendance_anomaly_digest', companyScoped: true },
  { key: 'auto_checkout', label: 'Auto check-out notice', audience: 'employee', trigger: 'Auto check-out closes a day left open.', preference: 'auto_checkout', companyScoped: true },
  { key: 'regularization_approved', label: 'Regularization approved', audience: 'employee', trigger: 'HR approves a regularization request.', preference: 'regularization', companyScoped: true },
  { key: 'regularization_rejected', label: 'Regularization rejected', audience: 'employee', trigger: 'HR rejects a regularization request.', preference: 'regularization', companyScoped: true },

  // ── Leave ────────────────────────────────────────────────────────────────
  { key: 'leave_applied', label: 'Leave applied', audience: 'employee', trigger: 'The employee applies for leave.', preference: 'leave_updates', companyScoped: true },
  { key: 'leave_approval_request', label: 'Leave needs approval', audience: 'manager', trigger: 'An employee applies for leave.', preference: 'leave_approval_requests', companyScoped: true },
  { key: 'leave_approved', label: 'Leave approved', audience: 'employee', trigger: 'Leave is approved.', preference: 'leave_updates', companyScoped: true },
  { key: 'leave_rejected', label: 'Leave rejected', audience: 'employee', trigger: 'Leave is rejected.', preference: 'leave_updates', companyScoped: true },
  { key: 'leave_balance_changed', label: 'Leave balance changed', audience: 'employee', trigger: "HR/Admin change the employee's leave allocation after it was first set (the first allocation sends nothing).", preference: 'leave_updates', companyScoped: true },
  { key: 'leave_balance_changed_admin', label: 'Leave balance changed (admin copy)', audience: 'company_admin', trigger: "Same change — tells the company's admins what it was and what it is now.", preference: 'leave_updates', companyScoped: true },
  { key: 'leave_balance_low', label: 'Low leave balance', audience: 'employee', trigger: 'Leave approval or weekly check finds the balance below threshold.', preference: 'leave_balance_low', companyScoped: true },

  // ── Payroll ──────────────────────────────────────────────────────────────
  { key: 'payslip', label: 'Payslip published', audience: 'employee', trigger: 'HR publishes a payslip.', preference: 'payslip', companyScoped: true },
  { key: 'salary_revised', label: 'Salary revised', audience: 'employee', trigger: 'A salary revision takes effect.', preference: 'salary_revision', companyScoped: true },
  { key: 'payslip_failed', label: 'Payslip generation failed', audience: 'hr', trigger: 'Nothing sends this yet.', preference: 'payroll_alerts', companyScoped: true, live: false },

  // ── HR digests ───────────────────────────────────────────────────────────
  { key: 'pending_approvals_digest', label: 'Pending approvals digest', audience: 'hr', trigger: 'Weekly digest cron, when approvals are waiting.', preference: 'pending_approvals_digest', companyScoped: true },
  { key: 'joiner_digest', label: 'Joiners & exits digest', audience: 'hr', trigger: 'Weekly digest cron.', preference: 'joiner_digest', companyScoped: true },

  // ── Celebrations ─────────────────────────────────────────────────────────
  { key: 'birthday_wish', label: 'Birthday wish', audience: 'employee', trigger: 'Birthday cron, 8 AM on the birthday.', preference: 'birthday_wishes', companyScoped: true },
  { key: 'work_anniversary', label: 'Work anniversary', audience: 'employee', trigger: 'Anniversary cron, 8 AM on the anniversary.', preference: 'work_anniversary_wishes', companyScoped: true },

  // ── Recruitment ──────────────────────────────────────────────────────────
  { key: 'offer_letter', label: 'Offer letter', audience: 'candidate', trigger: 'HR sends an offer to a candidate.', preference: 'recruitment', companyScoped: true },
  { key: 'offer_accepted', label: 'Offer accepted', audience: 'hr', trigger: 'A candidate accepts an offer.', preference: 'recruitment', companyScoped: true },
  { key: 'offer_rejected', label: 'Offer rejected', audience: 'hr', trigger: 'A candidate rejects an offer.', preference: 'recruitment', companyScoped: true },

  // ── Engagement ───────────────────────────────────────────────────────────
  { key: 'announcement', label: 'Announcement', audience: 'employee', trigger: 'HR publishes an announcement with email on.', preference: 'announcements', companyScoped: true },
  { key: 'holiday_list', label: 'Holiday list', audience: 'employee', trigger: 'HR imports a holiday list with email on — one email listing every holiday, not one per holiday.', preference: 'announcements', companyScoped: true },
  { key: 'training_assignment', label: 'Training assigned', audience: 'employee', trigger: 'Nothing sends this yet.', preference: 'training', companyScoped: true, live: false },
  { key: 'notification', label: 'In-app notification copy', audience: 'employee', trigger: 'Any in-app notification the company has email copies on for.', preference: 'notification_copies', companyScoped: true },

  // ── Security (always sent) ───────────────────────────────────────────────
  { key: 'api_key_created', label: 'API key created', audience: 'hr_admin', trigger: 'An API key is created.', preference: null, lock: 'security', companyScoped: true },
  { key: 'api_key_revoked', label: 'API key revoked', audience: 'hr_admin', trigger: 'An API key is revoked.', preference: null, lock: 'security', companyScoped: true },
  { key: 'beacon_first_ping', label: 'Office beacon first ping', audience: 'hr_admin', trigger: 'A new office IP beacon reports in for the first time.', preference: null, lock: 'security', companyScoped: true },
  { key: 'beacon_compromise_alert', label: 'Office beacon compromise alert', audience: 'hr_admin', trigger: 'A beacon changes IP suspiciously often.', preference: null, lock: 'security', companyScoped: true },
  { key: 'beacon_geo_mismatch', label: 'Office beacon location mismatch', audience: 'hr_admin', trigger: 'A beacon reports from an unexpected region.', preference: null, lock: 'security', companyScoped: true },

  // ── Subscription & billing (always sent) ─────────────────────────────────
  { key: 'subscription_welcome', label: 'Subscription started', audience: 'company_admin', trigger: 'A subscription is activated.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_renewed', label: 'Subscription renewed', audience: 'company_admin', trigger: 'A subscription renews.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_plan_changed', label: 'Plan changed', audience: 'company_admin', trigger: 'The plan is changed.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_renewal_reminder', label: 'Renewal reminder', audience: 'company_admin', trigger: 'Billing cron, 90/30/7/1 days before renewal.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_payment_failed', label: 'Payment failed', audience: 'company_admin', trigger: 'A renewal payment fails.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_grace_period_ending', label: 'Grace period ending', audience: 'company_admin', trigger: 'Billing cron, as the payment grace period runs out.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_suspended', label: 'Subscription suspended', audience: 'company_admin', trigger: 'The subscription is suspended for non-payment.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_trial_ending', label: 'Trial ending', audience: 'company_admin', trigger: 'Billing cron, two days before the trial ends.', preference: null, lock: 'billing', companyScoped: true },
  { key: 'subscription_trial_ended', label: 'Trial ended', audience: 'company_admin', trigger: 'The free trial ends.', preference: null, lock: 'billing', companyScoped: true },

  // ── Platform (not tied to a company) ─────────────────────────────────────
  { key: 'onboarding_otp', label: 'Workspace setup verification code', audience: 'prospect', trigger: 'A new customer verifies their email during workspace setup.', preference: null, lock: 'credentials', companyScoped: false },
  { key: 'company_invite', label: 'Workspace invite', audience: 'prospect', trigger: 'A super admin approves a trial lead.', preference: null, lock: 'platform', companyScoped: false },
  { key: 'lead_confirmation', label: 'Enquiry received', audience: 'prospect', trigger: 'Someone submits the trial or contact form.', preference: null, lock: 'platform', companyScoped: false },
  { key: 'lead_notification', label: 'New lead', audience: 'platform', trigger: 'Someone submits the trial or contact form.', preference: null, lock: 'platform', companyScoped: false },
  { key: 'cron_failure_alert', label: 'Scheduled job failed', audience: 'platform', trigger: 'A background job fails.', preference: null, lock: 'platform', companyScoped: false },
  { key: 'adms_unauthorized_alert', label: 'Rejected biometric device request', audience: 'platform', trigger: 'An unknown or unauthorised device calls the biometric endpoint.', preference: null, lock: 'platform', companyScoped: false },
  { key: 'adms_save_failure_alert', label: 'Biometric punches failing to save', audience: 'platform', trigger: 'Punches from a device fail to save to the database.', preference: null, lock: 'platform', companyScoped: false },
  { key: 'billing_alert', label: 'Billing job alert', audience: 'platform', trigger: 'The tenant billing job hits a problem.', preference: null, lock: 'platform', companyScoped: false },
];

const BY_KEY = new Map(EMAIL_TYPES.map((t) => [t.key, t]));

const getEmailType = (key) => BY_KEY.get(key) || null;

/** The catalogue as the super-admin screens want it: each email with its
 *  audience and switch spelled out, plus the switches themselves. */
const describeCatalog = () => ({
  audiences: AUDIENCE,
  preferences: PREFERENCE_KEYS.map((key) => ({
    key,
    ...PREFERENCES[key],
    emailTypes: EMAIL_TYPES.filter((t) => t.preference === key).map((t) => t.key),
  })),
  emailTypes: EMAIL_TYPES.map((t) => ({
    ...t,
    live: t.live !== false,
    audienceLabel: AUDIENCE[t.audience] || t.audience,
    lockReason: t.lock ? LOCK_REASONS[t.lock] : null,
    preferenceLabel: t.preference ? PREFERENCES[t.preference].label : null,
  })),
});

module.exports = {
  AUDIENCE,
  LOCK_REASONS,
  PREFERENCES,
  PREFERENCE_KEYS,
  EMAIL_TYPES,
  getEmailType,
  describeCatalog,
};
