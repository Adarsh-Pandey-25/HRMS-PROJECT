import { create } from 'zustand';
import { fetchWorkspaceApi } from '../api/auth.api';
import { getHostInfo } from '../lib/host';
import { useCompanyStore } from './companyStore';

/**
 * The company behind the current subdomain (tenant hosts only): its name,
 * logo and brand colour for the login pages, or `notFound` when the
 * subdomain has no company, so the app can show "Workspace not found".
 */
export const useWorkspaceStore = create((set, get) => ({
  status: 'idle', // idle | loading | ready | notFound | error
  workspace: null,

  load: async () => {
    if (get().status !== 'idle') return;
    if (getHostInfo().kind !== 'tenant') {
      set({ status: 'ready' });
      return;
    }
    set({ status: 'loading' });
    try {
      const data = await fetchWorkspaceApi();
      if (!data?.resolved) {
        set({ status: 'notFound', workspace: null });
        return;
      }
      set({ status: 'ready', workspace: data });
      // Brand the pre-login pages (and the tab title) with this company.
      const patch = { name: data.name };
      if (data.brandColor) patch.brandColor = data.brandColor;
      useCompanyStore.getState().updateCompany(patch);
    } catch (err) {
      if (err?.status === 404) {
        set({ status: 'notFound', workspace: null });
      } else {
        // Network or server trouble: don't lock people out of a real workspace.
        set({ status: 'error', workspace: null });
      }
    }
  },
}));
