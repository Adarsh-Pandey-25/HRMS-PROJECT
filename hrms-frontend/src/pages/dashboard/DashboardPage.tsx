import { authStore } from '../../store/auth'
import AdminDashboard from './AdminDashboard'
import TeamDashboard from './TeamDashboard'

export default function DashboardPage() {
  const me = authStore((s) => s.me)
  if (me?.role === 'admin') return <AdminDashboard />

  // For non-admin roles, keep the current dashboard for now.
  return <TeamDashboard />
}
