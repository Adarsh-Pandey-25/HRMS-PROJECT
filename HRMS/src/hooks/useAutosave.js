import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

/**
 * Item 4: shared autosave primitive for Settings forms — replaces the
 * explicit "Save Changes" button pattern with save-on-change, while giving
 * every consumer the same status state machine to drive a save-status
 * indicator: 'idle' -> 'saving' -> 'saved' (auto-fades back to 'idle' after
 * ~2s) or 'error' (stays until retried or the next save attempt).
 *
 * Toggles/selects/checkboxes should call `save` directly on change (they're
 * discrete actions, nothing to debounce). Text/number inputs should call
 * `save` on blur, not on every keystroke — deliberately simpler than a
 * debounce timer (no risk of firing mid-thought, no timer cleanup to get
 * wrong across many pages) and still meets "don't save on every
 * keystroke," per the explicit allowance in the spec to save on blur for
 * these fields.
 */
export function useAutosave(saveFn) {
  const [status, setStatus] = useState('idle');
  const lastArgsRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
    clearTimeout(fadeTimerRef.current);
  }, []);

  const save = useCallback(async (...args) => {
    lastArgsRef.current = args;
    clearTimeout(fadeTimerRef.current);
    setStatus('saving');
    try {
      await saveFn(...args);
      if (!mountedRef.current) return;
      setStatus('saved');
      fadeTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setStatus('idle');
      }, 2000);
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      toast.error(err.message || 'Failed to save');
    }
  }, [saveFn]);

  const retry = useCallback(() => {
    if (lastArgsRef.current) save(...lastArgsRef.current);
  }, [save]);

  return { status, save, retry };
}
