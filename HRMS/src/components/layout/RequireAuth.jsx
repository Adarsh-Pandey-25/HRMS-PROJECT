import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { AppShellSkeleton } from './AppShellSkeleton';

// Gate the main app behind sign-in (/login), once onboarding is complete.
export function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const userId = useAuthStore((s) => s.user?.id);

  if (!sessionChecked) {
    return <AppShellSkeleton />;
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
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
