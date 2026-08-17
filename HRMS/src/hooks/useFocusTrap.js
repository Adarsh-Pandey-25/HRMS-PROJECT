import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab focus inside a container while `active` is true, moves
 * focus into the container on activation (preferring `initialFocusRef` if
 * given, else the first focusable element, else the container itself), and
 * restores focus to whatever was focused before activation once it ends.
 *
 * Used by Modal and Drawer so every dialog in the app gets correct WCAG
 * focus management for free, instead of each usage reimplementing it.
 */
export function useFocusTrap(containerRef, active, initialFocusRef) {
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement;

    const container = containerRef.current;
    const focusFirst = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      const focusable = container?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusable && focusable.length > 0) focusable[0].focus();
      else container?.focus();
    };
    // Defer one tick so the dialog's contents are in the DOM before we focus.
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e) => {
      if (e.key !== 'Tab' || !container) return;
      const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      // Restore focus to whatever triggered the dialog.
      previouslyFocused.current?.focus?.();
    };
  }, [active, containerRef, initialFocusRef]);
}
