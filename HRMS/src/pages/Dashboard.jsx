import { useAuthStore, useCurrentUser } from '../store/authStore';
import AdminDashboard from './dashboard/AdminDashboard';
import HRDashboard from './dashboard/HRDashboard';
import ManagerDashboard from './dashboard/ManagerDashboard';
import EmployeeDashboard from './dashboard/EmployeeDashboard';

const DASHBOARDS = {
  admin: AdminDashboard,
  hr: HRDashboard,
  manager: ManagerDashboard,
  employee: EmployeeDashboard,
};

export default function Dashboard() {
  const role = useAuthStore((s) => s.role);
  const user = useCurrentUser();
  const RoleDashboard = DASHBOARDS[role] || EmployeeDashboard;
  return <RoleDashboard user={user} />;
}
