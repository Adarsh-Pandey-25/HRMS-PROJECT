import { Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { PageLoader } from './PageLoader';
import { useSuperAdminStore } from '../../store/superAdminStore';

export function RequireSuperAdmin() {
  const sessionChecked = useSuperAdminStore((s) => s.sessionChecked);
  const isAuthenticated = useSuperAdminStore((s) => s.isAuthenticated);
  const checkSession = useSuperAdminStore((s) => s.checkSession);

  useEffect(() => {
    if (!sessionChecked) checkSession();
  }, [sessionChecked, checkSession]);

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/super-admin/login" replace />;
  }

  return <Outlet />;
}
