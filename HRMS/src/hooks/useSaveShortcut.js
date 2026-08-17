import { useEffect } from 'react';

export const SAVE_SHORTCUT_EVENT = 'app:save-shortcut';

/**
 * Runs `onSave` when the user presses Ctrl/Cmd+S while this component is
 * mounted (e.g. a Settings section or a form page). The actual keydown
 * listener lives once in useGlobalShortcuts (mounted at the app shell) and
 * broadcasts this event — components just opt in with this one-liner.
 */
export function useSaveShortcut(onSave) {
  useEffect(() => {
    const handler = () => onSave?.();
    window.addEventListener(SAVE_SHORTCUT_EVENT, handler);
    return () => window.removeEventListener(SAVE_SHORTCUT_EVENT, handler);
  }, [onSave]);
}
