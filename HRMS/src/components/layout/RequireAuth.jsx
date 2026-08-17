import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { AppShellSkeleton } from './AppShellSkeleton';

// Gate the main app behind sign-in (/login), once onboarding is complete.
export function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);

  if (!sessionChecked) {
    return <AppShellSkeleton />;
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
