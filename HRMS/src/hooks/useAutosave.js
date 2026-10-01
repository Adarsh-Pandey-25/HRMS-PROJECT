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
 * `save` on blur, not on every keystroke.
 *
 * Every caller saves its whole form, so:
 *  - saves run one at a time. A save requested while one is running waits,
 *    and only the latest waiting one runs — two overlapping saves could
 *    otherwise finish out of order and leave the OLDER settings stored;
 *  - a save identical to the one running, or to the last one that
 *    succeeded, is skipped — focusing and leaving a field without changing
 *    it no longer re-saves, and React's dev-mode double call of a state
 *    updater no longer saves twice.
 */
const keyOf = (args) => {
  try { return JSON.stringify(args); } catch { return null; }
};

export function useAutosave(saveFn) {
  const [status, setStatus] = useState('idle');
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn;
  const lastArgsRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const runningKeyRef = useRef(undefined); // key of the save in flight; undefined = none
  const pendingRef = useRef(null); // latest args waiting behind it
  const savedKeyRef = useRef(undefined); // key of the last successful save

  // Set true on (re)mount, not just once: React's dev mode unmounts and
  // remounts every component, and a flag only ever cleared left this false
  // for good — every save then skipped "Saved" and the spinner never stopped.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const save = useCallback(async (...args) => {
    const key = keyOf(args);
    lastArgsRef.current = args;
    if (runningKeyRef.current !== undefined) {
      if (key !== null && key === runningKeyRef.current) { pendingRef.current = null; return; }
      pendingRef.current = args; // runs when the current save finishes
      return;
    }
    if (key !== null && key === savedKeyRef.current) return; // nothing changed

    clearTimeout(fadeTimerRef.current);
    setStatus('saving');
    let current = args;
    try {
      while (current) {
        const currentKey = keyOf(current);
        runningKeyRef.current = currentKey;
        pendingRef.current = null;
        // eslint-disable-next-line no-await-in-loop
        await saveFnRef.current(...current);
        savedKeyRef.current = currentKey;
        current = pendingRef.current;
        if (current && keyOf(current) === savedKeyRef.current) current = null;
      }
      if (!mountedRef.current) return;
      setStatus('saved');
      fadeTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setStatus('idle');
      }, 2000);
    } catch (err) {
      pendingRef.current = null;
      savedKeyRef.current = undefined; // let a retry of the same values go through
      if (!mountedRef.current) return;
      setStatus('error');
      toast.error(err.message || 'Failed to save');
    } finally {
      runningKeyRef.current = undefined;
    }
  }, []);

  const retry = useCallback(() => {
    if (lastArgsRef.current) save(...lastArgsRef.current);
  }, [save]);

  /** Record what is already stored (e.g. the form just loaded from the
   *  server), so saving it unchanged is skipped. */
  const markSaved = useCallback((...args) => {
    if (runningKeyRef.current === undefined) savedKeyRef.current = keyOf(args);
  }, []);

  return { status, save, retry, markSaved };
}
