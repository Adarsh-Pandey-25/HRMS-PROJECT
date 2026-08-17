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

export function resolveNotificationLink(link) {
  if (!link) return null;
  return LEGACY_LINKS[link] || link;
}
