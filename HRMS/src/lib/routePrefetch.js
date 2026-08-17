/**
 * Shared lazy loaders so nav can prefetch the same chunks App.jsx imports.
 * Call prefetchRoute(path) on hover/focus to warm the next module before click.
 */
const loaders = {
  '/dashboard': () => import('../pages/Dashboard'),
  '/employees': () => import('../pages/employees/EmployeeList'),
  '/employees/new': () => import('../pages/employees/EmployeeForm'),
  '/employees/import': () => import('../pages/employees/EmployeeImport'),
  '/attendance/me': () => import('../pages/attendance/MyAttendance'),
  '/attendance/team': () => import('../pages/attendance/TeamAttendance'),
  '/attendance/wfh-approvals': () => import('../pages/attendance/WfhApprovals'),
  '/attendance/regularize': () => import('../pages/attendance/Regularization'),
  '/attendance/shifts': () => import('../pages/attendance/Shifts'),
  '/leave/me': () => import('../pages/leave/MyLeave'),
  '/leave/apply': () => import('../pages/leave/ApplyLeave'),
  '/leave/team': () => import('../pages/leave/TeamLeave'),
  '/leave/approvals': () => import('../pages/leave/LeaveApprovals'),
  '/leave/holidays': () => import('../pages/leave/HolidayCalendar'),
  '/payroll/me': () => import('../pages/payroll/MyPayslips'),
  '/payroll/run': () => import('../pages/payroll/RunPayroll'),
  '/payroll/sheet': () => import('../pages/payroll/SalarySheet'),
  '/payroll/revisions': () => import('../pages/payroll/SalaryRevisions'),
  '/recruitment/jobs': () => import('../pages/recruitment/JobOpenings'),
  '/recruitment/jobs/add': () => import('../pages/recruitment/AddJob'),
  '/recruitment/candidates': () => import('../pages/recruitment/Candidates'),
  '/recruitment/interviews': () => import('../pages/recruitment/Interviews'),
  '/recruitment/offers': () => import('../pages/recruitment/Offers'),
  '/performance/goals': () => import('../pages/performance/MyGoals'),
  '/performance/team': () => import('../pages/performance/TeamReviews'),
  '/performance/cycles': () => import('../pages/performance/ReviewCycles'),
  '/training/catalog': () => import('../pages/training/CourseCatalog'),
  '/training/me': () => import('../pages/training/MyTrainings'),
  '/training/manage': () => import('../pages/training/ManageCourses'),
  '/training/enrollments': () => import('../pages/training/Enrollments'),
  '/assets/me': () => import('../pages/assets/MyAssets'),
  '/assets/inventory': () => import('../pages/assets/AssetInventory'),
  '/assets/requests': () => import('../pages/assets/AssetRequests'),
  '/assets/categories': () => import('../pages/assets/AssetCategories'),
  '/expenses/me': () => import('../pages/expenses/MyClaims'),
  '/expenses/submit': () => import('../pages/expenses/SubmitClaim'),
  '/expenses/approvals': () => import('../pages/expenses/ExpenseApprovals'),
  '/expenses/all': () => import('../pages/expenses/AllClaims'),
  '/helpdesk/me': () => import('../pages/helpdesk/MyTickets'),
  '/helpdesk/new': () => import('../pages/helpdesk/RaiseTicket'),
  '/helpdesk/all': () => import('../pages/helpdesk/AllTickets'),
  '/helpdesk/kb': () => import('../pages/helpdesk/KnowledgeBase'),
  '/announcements': () => import('../pages/Announcements'),
  '/organizations': () => import('../pages/organizations/Organizations'),
  '/settings': () => import('../pages/Settings'),
  '/search': () => import('../pages/SearchResults'),
};

const warmed = new Set();

function resolveLoader(pathname) {
  if (!pathname) return null;
  if (loaders[pathname]) return loaders[pathname];
  // /employees/:id → EmployeeProfile; /employees/:id/edit → Form
  if (/^\/employees\/[^/]+\/edit$/.test(pathname)) return () => import('../pages/employees/EmployeeForm');
  if (/^\/employees\/[^/]+$/.test(pathname)) return () => import('../pages/employees/EmployeeProfile');
  if (/^\/training\/courses\/[^/]+\/play$/.test(pathname)) return () => import('../pages/training/CoursePlayer');
  // Prefix match longest key first
  const keys = Object.keys(loaders).sort((a, b) => b.length - a.length);
  const hit = keys.find((k) => pathname === k || pathname.startsWith(`${k}/`));
  return hit ? loaders[hit] : null;
}

export function prefetchRoute(pathname) {
  const loader = resolveLoader(pathname);
  if (!loader) return;
  const key = pathname.split('?')[0];
  if (warmed.has(key) || warmed.has(loader)) return;
  warmed.add(key);
  warmed.add(loader);
  try {
    const p = loader();
    if (p && typeof p.then === 'function') p.catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Warm common modules after login during browser idle time. */
export function warmCriticalRoutes(role) {
  // Dashboard first — everything else waits so first paint stays fast.
  prefetchRoute('/dashboard');

  const deferred = [
    '/employees',
    '/announcements',
    '/leave/me',
    '/payroll/me',
    '/expenses/me',
    '/helpdesk/me',
    '/training/catalog',
    role === 'admin' || role === 'hr' ? '/attendance/team' : '/attendance/me',
  ];
  if (role === 'admin' || role === 'hr') {
    deferred.push('/leave/approvals', '/payroll/run');
  }

  const run = () => deferred.forEach((p) => prefetchRoute(p));
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 8000 });
  } else {
    setTimeout(run, 3000);
  }
}

export { loaders };
