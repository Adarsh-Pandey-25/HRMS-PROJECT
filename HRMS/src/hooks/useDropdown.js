import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Shared open/close behaviour for the small popover-style dropdowns in the
 * Topbar (announcements, role switcher, avatar menu): closes on outside
 * click AND on Escape, and returns focus to the trigger button when closed
 * via Escape so keyboard users don't lose their place.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, setOpen, close, containerRef, triggerRef };
}

/** Arrow-key roving focus between menu items inside a dropdown panel. */
const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="option"]';

export function handleMenuArrowKeys(e, panelRef) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = Array.from(panelRef.current?.querySelectorAll(MENU_ITEM_SELECTOR) || []);
  if (items.length === 0) return;
  const currentIndex = items.indexOf(document.activeElement);
  const nextIndex = e.key === 'ArrowDown'
    ? (currentIndex + 1) % items.length
    : (currentIndex - 1 + items.length) % items.length;
  items[nextIndex]?.focus();
}
