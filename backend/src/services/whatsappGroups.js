/**
 * The groups WhatsApp messages are sorted into — the switches a company
 * admin and each person see. A message goes only when its group is on for
 * the company AND for the person (a missing key means on).
 *
 * `audience` decides who sees a group's switch: everyone, HR/admin only,
 * company admins only, or super admins. `account` is not switchable: it
 * carries the one "your account was deactivated" notice.
 */
const GROUPS = {
  leave: {
    label: 'Leave', audience: 'everyone',
    description: 'Leave requests, approvals and balances',
  },
  attendance: {
    label: 'Attendance alerts', audience: 'everyone',
    description: 'Absent, late, short hours, automatic check-out and corrections',
  },
  payroll: {
    label: 'Payroll', audience: 'everyone',
    description: 'Payslips and salary updates — never amounts',
  },
  requests: {
    label: 'Requests and helpdesk', audience: 'everyone',
    description: 'Work from home, expenses, helpdesk tickets, documents and training',
  },
  company_news: {
    label: 'Company news', audience: 'everyone', marketing: true,
    description: 'Announcements and holiday lists',
  },
  my_celebrations: {
    label: 'My birthday and work anniversary', audience: 'everyone', marketing: true,
    description: 'Wishes on your own special days',
  },
  team_celebrations: {
    label: "Colleagues' birthdays and anniversaries", audience: 'everyone', marketing: true,
    description: 'A message on each colleague’s birthday and work anniversary',
  },
  summaries: {
    label: 'HR summaries', audience: 'hr_admin',
    description: 'Daily attendance summary, pending approvals, joiners and exits',
  },
  recruitment: {
    label: 'Recruitment', audience: 'hr_admin',
    description: 'A candidate accepted or declined an offer',
  },
  security: {
    label: 'Security', audience: 'hr_admin',
    description: 'API keys and office beacon alerts',
  },
  billing: {
    label: 'Billing', audience: 'admin',
    description: 'Your SpaxSync subscription and payments',
  },
  platform: {
    label: 'Platform alerts', audience: 'super_admin',
    description: 'New enquiries, failed background jobs, biometric device and billing job problems',
  },
  account: {
    label: 'Account', audience: 'everyone', locked: true,
    description: 'If your account is deactivated',
  },
};

const GROUP_KEYS = Object.keys(GROUPS);

/** Groups a company admin may switch off for everyone. */
const COMPANY_SWITCHABLE = GROUP_KEYS.filter((key) => !GROUPS[key].locked && GROUPS[key].audience !== 'super_admin');

const MARKETING_GROUPS = GROUP_KEYS.filter((key) => GROUPS[key].marketing);

/** The switches this person sees: 'employee' | 'manager' | 'hr' | 'admin' | 'super_admin'. */
const groupsForRole = (role) => GROUP_KEYS.filter((key) => {
  const { audience, locked } = GROUPS[key];
  if (locked) return false;
  if (role === 'super_admin') return audience === 'super_admin';
  if (audience === 'super_admin') return false;
  if (audience === 'admin') return role === 'admin';
  if (audience === 'hr_admin') return role === 'hr' || role === 'admin';
  return true;
});

/** Keeps only known, allowed keys with true/false values. */
const sanitizeGroups = (input, allowedKeys) => {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const key of allowedKeys) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
};

const isGroupOn = (groups, key) => !groups || groups[key] !== false;

/** The groups list as the website wants it, with each switch's current value. */
const describeGroups = (keys, values = {}) => keys.map((key) => ({
  key,
  label: GROUPS[key].label,
  description: GROUPS[key].description,
  marketing: Boolean(GROUPS[key].marketing),
  enabled: isGroupOn(values, key),
}));

module.exports = {
  GROUPS,
  GROUP_KEYS,
  COMPANY_SWITCHABLE,
  MARKETING_GROUPS,
  groupsForRole,
  sanitizeGroups,
  isGroupOn,
  describeGroups,
};
