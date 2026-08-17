import { Navigate, Outlet } from 'react-router-dom';
import { useCompanyStore } from '../../store/companyStore';

// Gate the main app behind the first-run boot flow (/welcome -> /onboarding).
export function RequireOnboarding() {
  const onboarded = useCompanyStore((s) => s.onboarded);
  if (!onboarded) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}
