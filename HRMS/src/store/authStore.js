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

  can: (allowedRoles) => {
    if (!allowedRoles || allowedRoles.length === 0) return true;
    return allowedRoles.includes(get().role);
  },

  login: async ({ email, password }) => {
    set({ isLoading: true, authError: null });
    try {
      clearSessionCache();
      const { user } = await loginApi(email, password);
      const role = user?.role || 'employee';
      set({
        user,
        role,
        isAuthenticated: true,
        sessionChecked: true,
        isLoading: false,
        authError: null,
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
    });
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
