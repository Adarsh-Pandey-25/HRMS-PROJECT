import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'w-[440px]', initialFocusRef }) {
  const containerRef = useRef(null);
  useFocusTrap(containerRef, open, initialFocusRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-fg/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'drawer-title' : undefined}
        tabIndex={-1}
        className={cn(
          'absolute right-0 top-0 h-full max-w-[92vw] bg-card shadow-drawer flex flex-col animate-slide-in-right outline-none',
          width
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border/60">
          <div className="min-w-0">
            {title && <h2 id="drawer-title" className="text-base font-semibold text-fg truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-fg-subtle truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="text-fg-subtle hover:text-fg rounded-md p-1 hover:bg-muted transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-border/60 flex items-center gap-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
