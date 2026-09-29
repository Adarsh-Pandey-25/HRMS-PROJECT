import { canRole, isPrivilegedRole } from './permissions';
import { isOwnEmployeeProfileSlug } from './employeeRoutes';

/** Map legacy / incorrect notification links to current frontend routes. */
const LEGACY_LINKS = {
  '/leaves?tab=team': '/leave/team',
  '/leaves?tab=all': '/leave/approvals',
  '/leaves?tab=mine': '/leave/me',
  '/reimbursements?tab=team': '/expenses/approvals',
  '/reimbursements?tab=all': '/expenses/all',
  '/reimbursements?tab=mine': '/expenses/me',
  '/documents': '/employees',
  '/payroll': '/payroll/me',
};

/**
 * What a notification target needs before the recipient can actually open it,
 * mirroring the route guards in App.jsx — keep the two in step.
 *
 * Several notifications are broadcast to everyone in the company but link to a
 * route only HR/Admin can open: the birthday announcement goes to every
 * employee and points at /employees/:id, so for most recipients clicking it
 * only ever produced "Access restricted". Rather than stripping the link (HR
 * genuinely wants it), the drawer drops it per recipient.
 *
 * Longest prefix wins, so /expenses/approvals is matched before any /expenses
 * rule that may be added later.
 */
const LINK_ACCESS = [
  ['/employees', { module: 'employees', action: 'view', allowSelfProfile: true }],
  ['/expenses/approvals', { module: 'expenses', action: 'approve' }],
  ['/expenses/all', { roles: ['admin', 'hr'] }],
  ['/helpdesk/all', { module: 'helpdesk', action: 'manage' }],
  ['/leave/approvals', { module: 'leave', action: 'approve' }],
  ['/leave/team', { roles: ['admin', 'hr', 'manager'] }],
].sort((a, b) => b[0].length - a[0].length);

function requirementFor(path) {
  const match = LINK_ACCESS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return match ? match[1] : null;
}

/**
 * True when `target` is a route this user can actually open. Unknown routes
 * are treated as reachable — this gate exists to stop a guaranteed dead end,
 * not to become a second, drifting copy of the router's permission table.
 */
export function canOpenNotificationLink(target, { role, rolePermissions, user } = {}) {
  if (!target || !role) return Boolean(target);
  const path = String(target).split('?')[0];
  const need = requirementFor(path);
  if (!need) return true;
  if (isPrivilegedRole(role)) return true;

  // An employee may always open their own profile, exactly as the
  // allowSelfEmployeeProfile escape hatch on the route itself allows.
  if (need.allowSelfProfile && path.startsWith('/employees/')) {
    if (isOwnEmployeeProfileSlug(path.slice('/employees/'.length), user)) return true;
  }
  if (need.roles) return need.roles.includes(role);
  return canRole(rolePermissions, role, need.module, need.action);
}

/**
 * The route to send the recipient to, or null when there is nothing they can
 * usefully open — the caller then still marks the notification read but does
 * not navigate, leaving it as the announcement it is.
 */
export function resolveNotificationLink(link, access) {
  if (!link) return null;
  const target = LEGACY_LINKS[link] || link;
  return canOpenNotificationLink(target, access) ? target : null;
}
