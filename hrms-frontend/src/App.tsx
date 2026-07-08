import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import AppLayout from './pages/layout/AppLayout'
import DashboardPage from './pages/dashboard/DashboardPage'
import AttendancePage from './pages/attendance/AttendancePage'
import LeavesPage from './pages/leaves/LeavesPage'
import EmployeesPage from './pages/employees/EmployeesPage'
import PayrollPage from './pages/payroll/PayrollPage'
import ReimbursementsPage from './pages/reimbursements/ReimbursementsPage'
import HolidaysPage from './pages/holidays/HolidaysPage'
import AnnouncementsPage from './pages/announcements/AnnouncementsPage'
import TrainingPage from './pages/training/TrainingPage'
import DocumentsPage from './pages/documents/DocumentsPage'
import ReportsPage from './pages/reports/ReportsPage'
import SettingsPage from './pages/settings/SettingsPage'
import RequireAuth from './routes/RequireAuth'
import RequireRole from './routes/RequireRole'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
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
