import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SAVE_SHORTCUT_EVENT } from './useSaveShortcut';
import { SHORTCUT_HELP_EVENT } from '../components/layout/ShortcutHelpModal';
import { prefetchRoute } from '../lib/routePrefetch';

/** Module landing routes for Alt+1…0. Parent paths (e.g. /attendance) redirect
 *  by role, so this stays correct for every role. */
const NAV_MAP = {
  Digit1: '/dashboard',
  Digit2: '/employees',
  Digit3: '/attendance',
  Digit4: '/leave',
  Digit5: '/payroll',
  Digit6: '/recruitment',
  Digit7: '/performance',
  Digit8: '/training',
  Digit9: '/assets',
  Digit0: '/helpdesk',
};

const isEditable = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

const focusSearch = () => document.getElementById('global-search-input')?.focus();

/**
 * App-wide keyboard shortcuts, mounted once at the app shell (AppLayout):
 *
 *  - Ctrl/Cmd+S — broadcasts a save event; forms/sections opt in via useSaveShortcut.
 *  - Ctrl/Cmd+F, Ctrl/Cmd+K, and "/" — focus the global search input.
 *  - Alt+1…0 — jump to each module (uses role-aware parent routes).
 *  - "?" — open the keyboard-shortcut help modal.
 *
 * Single-key shortcuts ("/", "?") are ignored while typing in an input,
 * textarea, select, or contenteditable so they never eat real keystrokes.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Ctrl/Cmd combos — work regardless of focus.
      if (mod) {
        if (key === 's') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(SAVE_SHORTCUT_EVENT));
        } else if (key === 'f' || key === 'k') {
          e.preventDefault();
          focusSearch();
        }
        return;
      }

      // Alt+digit — quick module navigation (use e.code so it's layout-proof).
      if (e.altKey) {
        const path = NAV_MAP[e.code];
        if (path) {
          e.preventDefault();
          // Warm the destination chunk so Suspense doesn't show on first click.
          prefetchRoute(path);
          navigate(path);
        }
        return;
      }

      // Bare keys — suppressed while typing.
      if (isEditable(document.activeElement)) return;

      if (e.key === '/') {
        e.preventDefault();
        focusSearch();
      } else if (e.key === '?') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_HELP_EVENT));
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate]);
}
