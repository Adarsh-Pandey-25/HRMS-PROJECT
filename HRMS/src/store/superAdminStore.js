import { create } from 'zustand';
import {
  superAdminLoginApi,
  superAdminVerifyTwoFactorApi,
  superAdminLogoutApi,
  superAdminMeApi,
} from '../api/superAdmin.api';

export const useSuperAdminStore = create((set, get) => ({
  admin: null,
  isAuthenticated: false,
  sessionChecked: false,
  isLoading: false,
  pendingTwoFactorToken: null,

  checkSession: async () => {
    try {
      const admin = await superAdminMeApi();
      set({ admin, isAuthenticated: true, sessionChecked: true });
    } catch {
      set({ admin: null, isAuthenticated: false, sessionChecked: true });
    }
  },

  login: async ({ email, password }) => {
    set({ isLoading: true });
    try {
      const result = await superAdminLoginApi(email, password);
      if (result?.twoFactorRequired) {
        set({ isLoading: false, pendingTwoFactorToken: result.pendingToken });
        return { twoFactorRequired: true };
      }
      set({ admin: result?.admin, isAuthenticated: true, isLoading: false, pendingTwoFactorToken: null });
      return result?.admin;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  verifyTwoFactor: async (code) => {
    const { pendingTwoFactorToken } = get();
    set({ isLoading: true });
    try {
      const admin = await superAdminVerifyTwoFactorApi(pendingTwoFactorToken, code);
      set({ admin, isAuthenticated: true, isLoading: false, pendingTwoFactorToken: null });
      return admin;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    await superAdminLogoutApi();
    set({ admin: null, isAuthenticated: false, pendingTwoFactorToken: null });
  },
}));
