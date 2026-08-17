import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { RequireAuth } from './components/layout/RequireAuth';
import { RequireSuperAdmin } from './components/layout/RequireSuperAdmin';
import { SuperAdminLayout } from './components/layout/SuperAdminLayout';
import { PageLoader } from './components/layout/PageLoader';
import { useAuthStore } from './store/authStore';
import { useApplyBrandColor } from './hooks/useApplyBrandColor';
import { useSyncDocumentTitle } from './hooks/useSyncDocumentTitle';
import { loaders } from './lib/routePrefetch';

const Welcome = lazy(() => import('./pages/Welcome'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const SuperAdminLogin = lazy(() => import('./pages/super-admin/Login'));
const SuperAdminCompanies = lazy(() => import('./pages/super-admin/Companies'));
const SuperAdminInvites = lazy(() => import('./pages/super-admin/Invites'));
const Dashboard = lazy(loaders['/dashboard']);
const EmployeeList = lazy(loaders['/employees']);
const EmployeeProfile = lazy(() => import('./pages/employees/EmployeeProfile'));
const EmployeeForm = lazy(loaders['/employees/new']);
const EmployeeImport = lazy(loaders['/employees/import']);

const MyAttendance = lazy(loaders['/attendance/me']);
const TeamAttendance = lazy(loaders['/attendance/team']);
const WfhApprovals = lazy(() => import('./pages/attendance/WfhApprovals'));
const Regularization = lazy(loaders['/attendance/regularize']);
const Shifts = lazy(loaders['/attendance/shifts']);

const MyLeave = lazy(loaders['/leave/me']);
const ApplyLeave = lazy(loaders['/leave/apply']);
const TeamLeave = lazy(loaders['/leave/team']);
const LeaveApprovals = lazy(loaders['/leave/approvals']);
const HolidayCalendar = lazy(loaders['/leave/holidays']);

const MyPayslips = lazy(loaders['/payroll/me']);
const RunPayroll = lazy(loaders['/payroll/run']);
const SalarySheet = lazy(loaders['/payroll/sheet']);
const SalaryRevisions = lazy(loaders['/payroll/revisions']);

const JobOpenings = lazy(loaders['/recruitment/jobs']);
const AddJob = lazy(loaders['/recruitment/jobs/add']);
const Candidates = lazy(loaders['/recruitment/candidates']);
const Interviews = lazy(loaders['/recruitment/interviews']);
const Offers = lazy(loaders['/recruitment/offers']);

const MyGoals = lazy(loaders['/performance/goals']);
const TeamReviews = lazy(loaders['/performance/team']);
const ReviewCycles = lazy(loaders['/performance/cycles']);

const CourseCatalog = lazy(loaders['/training/catalog']);
const MyTrainings = lazy(loaders['/training/me']);
const Enrollments = lazy(loaders['/training/enrollments']);
const CoursePlayer = lazy(() => import('./pages/training/CoursePlayer'));

const MyAssets = lazy(loaders['/assets/me']);
const AssetInventory = lazy(loaders['/assets/inventory']);
const AssetRequests = lazy(loaders['/assets/requests']);
const AssetCategories = lazy(loaders['/assets/categories']);

const MyClaims = lazy(loaders['/expenses/me']);
const SubmitClaim = lazy(loaders['/expenses/submit']);
const ExpenseApprovals = lazy(loaders['/expenses/approvals']);
const AllClaims = lazy(loaders['/expenses/all']);

const MyTickets = lazy(loaders['/helpdesk/me']);
const RaiseTicket = lazy(loaders['/helpdesk/new']);
const AllTickets = lazy(loaders['/helpdesk/all']);
const KnowledgeBase = lazy(loaders['/helpdesk/kb']);

const Announcements = lazy(loaders['/announcements']);
const Settings = lazy(loaders['/settings']);
const Organizations = lazy(loaders['/organizations']);
const SearchResults = lazy(loaders['/search']);
const NotFound = lazy(() => import('./pages/NotFound'));

/** Employee self-service routes — not for Admin. */
const SELF_SERVICE_ROLES = ['employee', 'manager', 'hr'];

// Guard only — Suspense lives once in AppLayout so the shell stays mounted.
const page = (Component, guard, options = {}) => {
  const el = <Component />;
  if (!guard) return el;
  if (Array.isArray(guard)) return <ProtectedRoute allowedRoles={guard}>{el}</ProtectedRoute>;
  return (
    <ProtectedRoute
      permission={guard}
      allowSelfEmployeeProfile={options.allowSelfEmployeeProfile}
    >
      {el}
    </ProtectedRoute>
  );
};

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const isAdmin = role === 'admin';
  useApplyBrandColor();
  useSyncDocumentTitle();

  return (
    <Routes>
      <Route path="/welcome" element={<Suspense fallback={<PageLoader />}><Welcome /></Suspense>} />
      <Route path="/onboarding" element={<Suspense fallback={<PageLoader />}><Onboarding /></Suspense>} />
      <Route path="/login" element={<Suspense fallback={<PageLoader />}><Login /></Suspense>} />
      <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPassword /></Suspense>} />

      {/* Platform Super Admin — must stay outside company RequireAuth + AppLayout */}
      <Route path="super-admin">
        <Route path="login" element={<Suspense fallback={<PageLoader />}><SuperAdminLogin /></Suspense>} />
        <Route element={<RequireSuperAdmin />}>
          <Route element={<SuperAdminLayout />}>
            <Route index element={<Navigate to="companies" replace />} />
            <Route path="companies" element={<Suspense fallback={<PageLoader />}><SuperAdminCompanies /></Suspense>} />
            <Route path="invites" element={<Suspense fallback={<PageLoader />}><SuperAdminInvites /></Suspense>} />
          </Route>
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={page(Dashboard)} />

            {/* Employees — Directory is the default, no redirect needed */}
            <Route path="/employees" element={page(EmployeeList, { module: 'employees', action: 'view' })} />
            <Route path="/employees/new" element={page(EmployeeForm, { module: 'employees', action: 'create' })} />
            <Route path="/employees/import" element={page(EmployeeImport, { module: 'employees', action: 'import' })} />
            <Route path="/employees/:id/edit" element={page(EmployeeForm, { module: 'employees', action: 'edit' })} />
            <Route
              path="/employees/:id"
              element={page(EmployeeProfile, { module: 'employees', action: 'view' }, { allowSelfEmployeeProfile: true })}
            />

            {/* Attendance */}
            <Route path="/attendance" element={<Navigate to={role === 'admin' || role === 'hr' ? '/attendance/team' : '/attendance/me'} replace />} />
            <Route path="/attendance/me" element={page(MyAttendance, SELF_SERVICE_ROLES)} />
            <Route path="/attendance/team" element={page(TeamAttendance, ['admin', 'hr', 'manager'])} />
            <Route path="/attendance/wfh-approvals" element={page(WfhApprovals, { module: 'attendance', action: 'approve' })} />
            <Route path="/attendance/regularize" element={page(Regularization, { module: 'attendance', action: 'view' })} />
            <Route path="/attendance/shifts" element={page(Shifts, { module: 'attendance', action: 'manage' })} />

            {/* Leave */}
            <Route path="/leave" element={<Navigate to={isAdmin ? '/leave/approvals' : '/leave/me'} replace />} />
            <Route path="/leave/me" element={page(MyLeave, SELF_SERVICE_ROLES)} />
            <Route path="/leave/apply" element={page(ApplyLeave, SELF_SERVICE_ROLES)} />
            <Route path="/leave/team" element={page(TeamLeave, ['admin', 'hr', 'manager'])} />
            <Route path="/leave/approvals" element={page(LeaveApprovals, { module: 'leave', action: 'approve' })} />
            <Route path="/leave/holidays" element={page(HolidayCalendar, { module: 'leave', action: 'view' })} />

            {/* Payroll */}
            <Route path="/payroll" element={<Navigate to={isAdmin ? '/payroll/run' : '/payroll/me'} replace />} />
            <Route path="/payroll/me" element={page(MyPayslips, SELF_SERVICE_ROLES)} />
            <Route path="/payroll/run" element={page(RunPayroll, { module: 'payroll', action: 'manage' })} />
            <Route path="/payroll/sheet" element={page(SalarySheet, { module: 'payroll', action: 'manage' })} />
            <Route path="/payroll/revisions" element={page(SalaryRevisions, { module: 'payroll', action: 'manage' })} />

            {/* Recruitment */}
            <Route path="/recruitment" element={<Navigate to="/recruitment/jobs" replace />} />
            <Route path="/recruitment/jobs" element={page(JobOpenings, { module: 'recruitment', action: 'view' })} />
            <Route path="/recruitment/jobs/add" element={page(AddJob, { module: 'recruitment', action: 'create' })} />
            <Route path="/recruitment/candidates" element={page(Candidates, { module: 'recruitment', action: 'view' })} />
            <Route path="/recruitment/interviews" element={page(Interviews, { module: 'recruitment', action: 'manage' })} />
            <Route path="/recruitment/offers" element={page(Offers, { module: 'recruitment', action: 'manage' })} />

            {/* Performance */}
            <Route path="/performance" element={<Navigate to={role === 'admin' || role === 'hr' ? '/performance/team' : '/performance/goals'} replace />} />
            <Route path="/performance/goals" element={page(MyGoals, SELF_SERVICE_ROLES)} />
            <Route path="/performance/team" element={page(TeamReviews, { module: 'performance', action: 'approve' })} />
            <Route path="/performance/cycles" element={page(ReviewCycles, { module: 'performance', action: 'manage' })} />

            {/* Training */}
            <Route path="/training" element={<Navigate to="/training/catalog" replace />} />
            <Route path="/training/catalog" element={page(CourseCatalog, { module: 'training', action: 'view' })} />
            <Route path="/training/courses/:id/play" element={page(CoursePlayer, { module: 'training', action: 'view' })} />
            <Route path="/training/me" element={page(MyTrainings, SELF_SERVICE_ROLES)} />
            <Route path="/training/new-joiner" element={<Navigate to="/training/catalog" replace />} />
            <Route path="/training/manage" element={<Navigate to="/training/catalog" replace />} />
            <Route path="/training/enrollments" element={page(Enrollments, { module: 'training', action: 'manage' })} />

            {/* Assets */}
            <Route path="/assets" element={<Navigate to={isAdmin ? '/assets/inventory' : '/assets/me'} replace />} />
            <Route path="/assets/me" element={page(MyAssets, SELF_SERVICE_ROLES)} />
            <Route path="/assets/inventory" element={page(AssetInventory, { module: 'assets', action: 'edit' })} />
            <Route path="/assets/requests" element={page(AssetRequests, SELF_SERVICE_ROLES)} />
            <Route path="/assets/categories" element={page(AssetCategories, { module: 'assets', action: 'manage' })} />

            {/* Expenses */}
            <Route path="/expenses" element={<Navigate to={isAdmin ? '/expenses/all' : '/expenses/me'} replace />} />
            <Route path="/expenses/me" element={page(MyClaims, SELF_SERVICE_ROLES)} />
            <Route path="/expenses/submit" element={page(SubmitClaim, SELF_SERVICE_ROLES)} />
            <Route path="/expenses/approvals" element={page(ExpenseApprovals, { module: 'expenses', action: 'approve' })} />
            <Route path="/expenses/all" element={page(AllClaims, ['admin', 'hr'])} />

            {/* Helpdesk */}
            <Route path="/helpdesk" element={<Navigate to={isAdmin ? '/helpdesk/all' : '/helpdesk/me'} replace />} />
            <Route path="/helpdesk/me" element={page(MyTickets, SELF_SERVICE_ROLES)} />
            <Route path="/helpdesk/new" element={page(RaiseTicket, SELF_SERVICE_ROLES)} />
            <Route path="/helpdesk/all" element={page(AllTickets, { module: 'helpdesk', action: 'manage' })} />
            <Route path="/helpdesk/kb" element={page(KnowledgeBase, { module: 'helpdesk', action: 'view' })} />

            <Route path="/announcements" element={page(Announcements, { module: 'announcements', action: 'view' })} />
            <Route path="/organizations" element={page(Organizations, ['admin'])} />
            <Route path="/settings" element={page(Settings, { module: 'settings', action: 'manage' })} />
            <Route path="/search" element={page(SearchResults)} />
            <Route path="/404" element={page(NotFound)} />
          </Route>
        </Route>

      <Route
        path="/"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />
      {/* Catch-all last — do not nest under AppLayout or it steals /super-admin/* */}
      <Route
        path="*"
        element={
          isAuthenticated
            ? <Navigate to="/404" replace />
            : <Navigate to="/login" replace />
        }
      />
    </Routes>
  );
}
