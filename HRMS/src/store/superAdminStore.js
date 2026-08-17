import { create } from 'zustand';
import {
  superAdminLoginApi,
  superAdminLogoutApi,
  superAdminMeApi,
} from '../api/superAdmin.api';

export const useSuperAdminStore = create((set, get) => ({
  admin: null,
  isAuthenticated: false,
  sessionChecked: false,
  isLoading: false,

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
      const admin = await superAdminLoginApi(email, password);
      set({ admin, isAuthenticated: true, isLoading: false });
      return admin;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    await superAdminLogoutApi();
    set({ admin: null, isAuthenticated: false });
  },
}));
