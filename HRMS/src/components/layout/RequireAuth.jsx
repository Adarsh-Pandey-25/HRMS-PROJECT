import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { lastLoginPath } from '../../lib/host';
import { AppShellSkeleton } from './AppShellSkeleton';

export const COMPLETE_PROFILE_PATH = '/complete-profile';

// Gate the main app behind sign-in — back to the portal the user last used
// (/, /admin or /hr on the company subdomain).
export function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const userId = useAuthStore((s) => s.user?.id);
  // Someone HR/Admin added without their personal details fills them in
  // before anything else (profileCompletion.service.js on the server). Not
  // during a super-admin impersonation: support must not fill these in.
  const mustCompleteProfile = useAuthStore(
    (s) => s.user?.profileCompleted === false && !s.user?.impersonation,
  );
  const { pathname } = useLocation();

  if (!sessionChecked) {
    return <AppShellSkeleton />;
  }

  if (!isAuthenticated) return <Navigate to={lastLoginPath()} replace />;
  if (mustCompleteProfile && pathname !== COMPLETE_PROFILE_PATH) {
    return <Navigate to={COMPLETE_PROFILE_PATH} replace />;
  }
  if (!mustCompleteProfile && pathname === COMPLETE_PROFILE_PATH) {
    return <Navigate to="/dashboard" replace />;
  }
  // key={userId}: every store/hook feeding the authenticated tree (role,
  // nav, dashboard) is provably correct by itself — traced end to end,
  // login()'s atomic set() always lands role+isAuthenticated+sessionChecked
  // together before navigate() fires. But "log in as Admin, briefly see
  // Employee, refresh fixes it" is the textbook symptom of a STALE CLOSURE
  // somewhere deep in this large tree (a useMemo/useCallback/React.memo
  // that missed role or user.id in its dependency array) rather than a
  // wrong value at the source — auditing every memoized component for that
  // isn't tractable. Keying the whole authenticated subtree on the actual
  // logged-in identity forces React to fully unmount and remount it
  // whenever that identity changes (login after logout, switching users,
  // impersonation start/end), which eliminates this entire bug class
  // regardless of which component down-tree is holding a stale closure.
  return <Outlet key={userId || 'anon'} />;
}
