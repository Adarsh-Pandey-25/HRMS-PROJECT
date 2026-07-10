import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './routes/RequireAuth'
import RequireRole from './routes/RequireRole'
import AppLayout from './pages/layout/AppLayout'
import { PageLoadingSkeleton } from './components/ui'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'))
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage'))
const LeavesPage = lazy(() => import('./pages/leaves/LeavesPage'))
const EmployeesPage = lazy(() => import('./pages/employees/EmployeesPage'))
const PayrollPage = lazy(() => import('./pages/payroll/PayrollPage'))
const ReimbursementsPage = lazy(() => import('./pages/reimbursements/ReimbursementsPage'))
const HolidaysPage = lazy(() => import('./pages/holidays/HolidaysPage'))
const AnnouncementsPage = lazy(() => import('./pages/announcements/AnnouncementsPage'))
const TrainingPage = lazy(() => import('./pages/training/TrainingPage'))
const CoursePlayerPage = lazy(() => import('./pages/training/CoursePlayerPage'))
const TrainingManagePage = lazy(() => import('./pages/training/TrainingManagePage'))
const DocumentsPage = lazy(() => import('./pages/documents/DocumentsPage'))
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Suspense fallback={<PageLoadingSkeleton />}><LoginPage /></Suspense>} />
      <Route path="/forgot-password" element={<Suspense fallback={<PageLoadingSkeleton />}><ForgotPasswordPage /></Suspense>} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
          <Route path="/leaves" element={<LeavesPage />} />
          <Route path="/leaves/approvals" element={<Navigate to="/leaves?tab=team" replace />} />
          <Route path="/payroll" element={<PayrollPage />} />
          <Route path="/reimbursements" element={<ReimbursementsPage />} />
          <Route path="/holidays" element={<HolidaysPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/training/course/:id" element={<CoursePlayerPage />} />

          <Route element={<RequireRole roles={['admin', 'hr', 'manager']} />}>
            <Route path="/training/manage" element={<TrainingManagePage />} />
          </Route>
          <Route path="/documents" element={<DocumentsPage />} />

          <Route element={<RequireRole roles={['admin', 'hr']} />}>
            <Route path="/employees" element={<EmployeesPage />} />
          </Route>

          <Route element={<RequireRole roles={['admin', 'hr', 'manager']} />}>
            <Route path="/reports" element={<ReportsPage />} />
          </Route>

          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
