import { create } from 'zustand';

/**
 * Item 4: shared so both the auto-shown floating banner (PwaInstallPrompt,
 * mounted once at the app root) and the manual "Install App" entry in
 * Settings can trigger the same underlying browser install flow — the
 * native `beforeinstallprompt` event only fires once and must be captured
 * wherever it lands, then reused from anywhere in the app.
 */
export const usePwaInstallStore = create((set, get) => ({
  standalone: false,
  deferred: null,
  guideOpen: false,
  installing: false,

  setStandalone: (standalone) => set({ standalone }),
  setDeferred: (deferred) => set({ deferred }),
  openGuide: () => set({ guideOpen: true }),
  closeGuide: () => set({ guideOpen: false }),

  /** Manual trigger — used by both the banner's Install button and Settings' "Install App" action. */
  install: async () => {
    const { deferred } = get();
    if (!deferred) {
      set({ guideOpen: true });
      return { outcome: 'unavailable' };
    }
    set({ installing: true });
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome !== 'accepted') set({ guideOpen: true });
      return choice;
    } catch {
      set({ guideOpen: true });
      return { outcome: 'error' };
    } finally {
      set({ installing: false, deferred: null });
    }
  },
}));
