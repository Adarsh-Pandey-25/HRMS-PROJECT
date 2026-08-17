import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useUIStore = create(
  persist(
    (set) => ({
      isDark: false,
      sidebarCollapsed: false,
      topbarActionsCollapsed: false,
      mobileNavOpen: false,
      openNavGroup: null,

      toggleDark: () =>
        set((s) => {
          const isDark = !s.isDark;
          document.documentElement.classList.toggle('dark', isDark);
          return { isDark };
        }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleTopbarActions: () => set((s) => ({ topbarActionsCollapsed: !s.topbarActionsCollapsed })),
      setMobileNav: (open) => set({ mobileNavOpen: open }),
      // Accordion sidebar — only one group open at a time (null = all collapsed).
      setOpenNavGroup: (group) => set({ openNavGroup: group }),
    }),
    {
      name: 'zenith-ui',
      onRehydrateStorage: () => (state) => {
        // Apply persisted theme on load.
        if (state?.isDark) document.documentElement.classList.add('dark');
      },
    }
  )
);
