import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarOff,
  DollarSign,
  Briefcase,
  TrendingUp,
  BookOpen,
  Monitor,
  Receipt,
  LifeBuoy,
  Megaphone,
  Settings,
  Building2,
  BarChart3,
} from 'lucide-react';
import { canRole, isPrivilegedRole } from './permissions';

/** Self-service items — employees/managers/HR use these; Admin uses team/manage views instead. */
const SELF_SERVICE = { excludeRoles: ['admin'] };

/**
 * Accordion sidebar config.
 * - `roles` = optional role allow-list
 * - `excludeRoles` = hide for these roles (checked before admin bypass)
 * - `permission` = { module, action } from Settings RBAC matrix
 */
export const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  {
    icon: Building2,
    label: 'Organizations',
    roles: ['admin', 'hr'],
    children: [
      { label: 'Companies', path: '/organizations', roles: ['admin', 'hr'] },
    ],
  },
  {
    icon: Users,
    label: 'Employees',
    permission: { module: 'employees', action: 'view' },
    children: [
      { label: 'Directory', path: '/employees', permission: { module: 'employees', action: 'view' } },
      { label: 'Add Employee', path: '/employees/new', permission: { module: 'employees', action: 'create' } },
      { label: 'Bulk Import', path: '/employees/import', permission: { module: 'employees', action: 'import' } },
    ],
  },
  {
    icon: Clock,
    label: 'Attendance',
    children: [
      { label: 'My Attendance', path: '/attendance/me', permission: { module: 'attendance', action: 'view' }, ...SELF_SERVICE },
      { label: 'Team Attendance', path: '/attendance/team', permission: { module: 'attendance', action: 'view' }, roles: ['admin', 'hr', 'manager'] },
      { label: 'WFH Approvals', path: '/attendance/wfh-approvals', permission: { module: 'attendance', action: 'approve' } },
      { label: 'Regularization', path: '/attendance/regularize', permission: { module: 'attendance', action: 'view' }, roles: ['employee', 'manager', 'hr', 'admin'] },
      { label: 'Shifts', path: '/attendance/shifts', permission: { module: 'attendance', action: 'manage' } },
    ],
  },
  {
    icon: CalendarOff,
    label: 'Leave',
    children: [
      { label: 'My Leaves', path: '/leave/me', permission: { module: 'leave', action: 'view' }, ...SELF_SERVICE },
      { label: 'Apply Leave', path: '/leave/apply', permission: { module: 'leave', action: 'create' }, roles: ['employee', 'manager', 'hr'] },
      { label: 'Team Leaves', path: '/leave/team', permission: { module: 'leave', action: 'view' }, roles: ['admin', 'hr', 'manager'] },
      { label: 'Approvals', path: '/leave/approvals', permission: { module: 'leave', action: 'approve' } },
      { label: 'Holiday Calendar', path: '/leave/holidays', permission: { module: 'leave', action: 'view' } },
    ],
  },
  {
    icon: DollarSign,
    label: 'Payroll',
    children: [
      { label: 'My Payslips', path: '/payroll/me', permission: { module: 'payroll', action: 'view' }, ...SELF_SERVICE },
      { label: 'Run Payroll', path: '/payroll/run', permission: { module: 'payroll', action: 'manage' } },
      { label: 'Salary Sheet', path: '/payroll/sheet', permission: { module: 'payroll', action: 'manage' } },
      { label: 'Salary Revisions', path: '/payroll/revisions', permission: { module: 'payroll', action: 'manage' } },
    ],
  },
  {
    icon: Briefcase,
    label: 'Recruitment',
    permission: { module: 'recruitment', action: 'view' },
    children: [
      { label: 'Job Openings', path: '/recruitment/jobs', permission: { module: 'recruitment', action: 'view' } },
      { label: 'Add Job', path: '/recruitment/jobs/add', permission: { module: 'recruitment', action: 'create' } },
      { label: 'Candidates', path: '/recruitment/candidates', permission: { module: 'recruitment', action: 'view' } },
      { label: 'Interviews', path: '/recruitment/interviews', permission: { module: 'recruitment', action: 'manage' } },
      { label: 'Offers', path: '/recruitment/offers', permission: { module: 'recruitment', action: 'manage' } },
    ],
  },
  {
    icon: TrendingUp,
    label: 'Performance',
    permission: { module: 'performance', action: 'view' },
    children: [
      { label: 'My Goals', path: '/performance/goals', permission: { module: 'performance', action: 'view' }, ...SELF_SERVICE },
      { label: 'Team Reviews', path: '/performance/team', permission: { module: 'performance', action: 'approve' } },
      { label: 'Review Cycles', path: '/performance/cycles', permission: { module: 'performance', action: 'manage' } },
    ],
  },
  {
    icon: BookOpen,
    label: 'Training',
    children: [
      { label: 'Course Catalog', path: '/training/catalog', permission: { module: 'training', action: 'view' } },
      { label: 'My Trainings', path: '/training/me', permission: { module: 'training', action: 'view' }, ...SELF_SERVICE },
      { label: 'Enrollments', path: '/training/enrollments', permission: { module: 'training', action: 'manage' } },
    ],
  },
  {
    icon: Monitor,
    label: 'Assets',
    children: [
      { label: 'My Assets', path: '/assets/me', permission: { module: 'assets', action: 'view' }, ...SELF_SERVICE },
      { label: 'Asset Inventory', path: '/assets/inventory', permission: { module: 'assets', action: 'edit' } },
      { label: 'Asset Requests', path: '/assets/requests', permission: { module: 'assets', action: 'view' }, ...SELF_SERVICE },
      { label: 'Asset Categories', path: '/assets/categories', permission: { module: 'assets', action: 'manage' } },
    ],
  },
  {
    icon: Receipt,
    label: 'Expenses',
    children: [
      { label: 'My Claims', path: '/expenses/me', permission: { module: 'expenses', action: 'view' }, ...SELF_SERVICE },
      { label: 'Submit Claim', path: '/expenses/submit', permission: { module: 'expenses', action: 'create' }, ...SELF_SERVICE },
      { label: 'Approval Queue', path: '/expenses/approvals', permission: { module: 'expenses', action: 'approve' } },
      { label: 'All Claims', path: '/expenses/all', permission: { module: 'expenses', action: 'view' }, roles: ['admin', 'hr'] },
    ],
  },
  {
    icon: LifeBuoy,
    label: 'Helpdesk',
    children: [
      { label: 'My Tickets', path: '/helpdesk/me', permission: { module: 'helpdesk', action: 'view' }, ...SELF_SERVICE },
      { label: 'Raise Ticket', path: '/helpdesk/new', permission: { module: 'helpdesk', action: 'create' }, ...SELF_SERVICE },
      { label: 'All Tickets', path: '/helpdesk/all', permission: { module: 'helpdesk', action: 'manage' } },
      { label: 'Knowledge Base', path: '/helpdesk/kb', permission: { module: 'helpdesk', action: 'view' } },
    ],
  },
  {
    icon: BarChart3,
    label: 'Reports',
    path: '/reports',
    permission: { module: 'reports', action: 'view' },
  },
];

export const PINNED_NAV_ITEMS = [
  { icon: Megaphone, label: 'Announcements', path: '/announcements', permission: { module: 'announcements', action: 'view' } },
  { icon: Settings, label: 'Settings', path: '/settings', permission: { module: 'settings', action: 'manage' } },
];

function allowed(item, role, rolePermissions) {
  if (item.excludeRoles?.includes(role)) return false;
  if (item.roles && !item.roles.includes(role)) return false;
  if (isPrivilegedRole(role)) return true;
  if (item.permission) {
    return canRole(rolePermissions, role, item.permission.module, item.permission.action);
  }
  return true;
}

export function visibleNav(role, rolePermissions) {
  return NAV_ITEMS.filter((item) => allowed(item, role, rolePermissions))
    .map((item) => (item.children
      ? { ...item, children: item.children.filter((c) => allowed(c, role, rolePermissions)) }
      : item))
    .filter((item) => !item.children || item.children.length > 0);
}

export function visiblePinnedItems(role, rolePermissions) {
  return PINNED_NAV_ITEMS.filter((item) => allowed(item, role, rolePermissions));
}

export const DEPARTMENTS = [
  'Engineering',
  'Product',
  'Design',
  'Marketing',
  'Sales',
  'Human Resources',
  'Finance',
  'Operations',
  'Customer Success',
];

// Work locations now live in useSettingsStore (s.locations) so they're
// extensible from the Employee Directory's "Add location" control.

export const ROLES = ['admin', 'hr', 'manager', 'employee'];

export const INDUSTRIES = ['IT', 'Manufacturing', 'Healthcare', 'Education', 'Retail', 'Other'];

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'];

export const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'intern'];

/**
 * Maps arbitrary status/enum strings to a Badge tone.
 * Anything unmapped falls back to 'neutral'.
 */
export const STATUS_TONE = {
  // employment
  active: 'success',
  probation: 'warning',
  'on-leave': 'info',
  resigned: 'neutral',
  terminated: 'danger',
  'pending-setup': 'warning',
  // generic workflow
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  draft: 'neutral',
  processing: 'info',
  processed: 'info',
  'auto-processed': 'teal',
  paid: 'success',
  // attendance
  present: 'success',
  absent: 'danger',
  late: 'warning',
  'half-day': 'info',
  wfh: 'primary',
  holiday: 'neutral',
  // recruitment stages
  applied: 'neutral',
  screening: 'info',
  interview: 'primary',
  technical: 'primary',
  'hr-round': 'warning',
  offer: 'teal',
  hired: 'success',
  // tickets
  open: 'info',
  'in-progress': 'primary',
  waiting: 'warning',
  resolved: 'success',
  closed: 'neutral',
  // priorities
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
  // goals / training
  'not-started': 'neutral',
  'in-progress-goal': 'info',
  completed: 'success',
  missed: 'danger',
  // assets
  available: 'success',
  assigned: 'info',
  'in-repair': 'warning',
  retired: 'neutral',
};

/** Announcement priority -> Badge tone. */
export const PRIORITY_TONE = {
  normal: 'neutral',
  important: 'warning',
  urgent: 'danger',
};

/** Chart palette used across dashboards. */
export const CHART_COLORS = [
  '#6C63FF',
  '#14B8A6',
  '#F59E0B',
  '#EF4444',
  '#3B82F6',
  '#EC4899',
  '#10B981',
  '#F97316',
];
