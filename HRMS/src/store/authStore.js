import { create } from 'zustand';
import { loginApi, logoutApi, fetchMeApi } from '../api/auth.api';
import { fetchDashboardApi } from '../api/dashboard.api';
import { fetchRolePermissionsApi } from '../api/settings.api';
import { registerLogoutHandler, setStoredToken } from '../api/client';
import { queryClient } from '../lib/queryClient';
import { prefetchRoute } from '../lib/routePrefetch';

function clearSessionCache() {
  queryClient.clear();
}

function primeAuthenticatedCaches(role) {
  prefetchRoute('/dashboard');
  queryClient.prefetchQuery({
    queryKey: ['dashboard', role],
    queryFn: () => fetchDashboardApi(role),
    staleTime: 60_000,
  });
  queryClient.prefetchQuery({
    queryKey: ['settings', 'role_permissions'],
    queryFn: fetchRolePermissionsApi,
    staleTime: 60_000,
  });
}

let hydrationPromise = null;

export const useAuthStore = create((set, get) => ({
  user: null,
  role: 'employee',
  isAuthenticated: false,
  /** False until cookie session has been checked (avoids blank screen on reload). */
  sessionChecked: false,
  isLoading: false,
  authError: null,
  /** Temp password from login — used once for forced password change, never persisted. */
  pendingLoginPassword: null,

  can: (allowedRoles) => {
    if (!allowedRoles || allowedRoles.length === 0) return true;
    return allowedRoles.includes(get().role);
  },

  /** `portal` scopes the login to /auth/{portal}/login ('admin' | 'hr' | 'employee');
   *  omitted, it hits the original unscoped /auth/login (legacy /login page). */
  login: async ({ email, password, portal }) => {
    set({ isLoading: true, authError: null });
    try {
      clearSessionCache();
      const { user } = await loginApi(email, password, portal);
      const role = user?.role || 'employee';
      set({
        user,
        role,
        isAuthenticated: true,
        sessionChecked: true,
        isLoading: false,
        authError: null,
        pendingLoginPassword: user?.mustChangePassword ? password : null,
      });
      primeAuthenticatedCaches(role);
      return { user };
    } catch (err) {
      set({ isLoading: false, authError: err.message });
      throw err;
    }
  },

  logout: async ({ silent = false } = {}) => {
    if (!silent) {
      try {
        await logoutApi();
      } catch {
        /* token may already be invalid */
      }
    }
    setStoredToken(null);
    clearSessionCache();
    set({
      user: null,
      isAuthenticated: false,
      role: 'employee',
      authError: null,
      sessionChecked: true,
      pendingLoginPassword: null,
    });
  },

  clearPasswordChangeRequirement: () => {
    set((state) => ({
      pendingLoginPassword: null,
      user: state.user ? { ...state.user, mustChangePassword: false } : null,
    }));
  },

  /** Restore session from the HttpOnly access cookie on app boot. */
  hydrateSession: async () => {
    set({ isLoading: true });
    try {
      const user = await fetchMeApi();
      const role = user?.role || 'employee';
      set({
        user,
        role,
        isAuthenticated: true,
        sessionChecked: true,
        isLoading: false,
      });
      primeAuthenticatedCaches(role);
      return true;
    } catch {
      setStoredToken(null);
      clearSessionCache();
      set({
        user: null,
        isAuthenticated: false,
        role: 'employee',
        sessionChecked: true,
        isLoading: false,
      });
      return false;
    }
  },
}));

/**
 * Item 1: `role` is a separate top-level field from `user.role`, kept in
 * sync by convention — every action above (login/hydrateSession/logout)
 * currently does derive+set it correctly in the same atomic call, audited
 * end to end. But "kept in sync by convention across N call sites" is
 * exactly the "two places tracking role that can drift" shape of bug this
 * was reported as, and relying on every future call site to remember to
 * do it right is fragile. This subscriber makes it a structural
 * invariant instead of a convention: any state change, from any action,
 * that leaves `role` not matching `user.role` is corrected in the same
 * synchronous tick, before React renders anything from it — so `role` can
 * no longer diverge even if some future code path forgets to set it
 * alongside `user`.
 */
useAuthStore.subscribe((state) => {
  const derivedRole = state.user?.role || 'employee';
  if (state.role !== derivedRole) {
    useAuthStore.setState({ role: derivedRole });
  }
});

/** Start session restore immediately — don't wait for React mount. */
export function startSessionHydration() {
  if (!hydrationPromise) {
    hydrationPromise = useAuthStore.getState().hydrateSession();
  }
  return hydrationPromise;
}

registerLogoutHandler((opts) => useAuthStore.getState().logout(opts));

/** Resolves the logged-in user from the auth store (API-backed). */
export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}
