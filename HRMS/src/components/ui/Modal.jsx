import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', initialFocusRef, titleId }) {
  const containerRef = useRef(null);
  const headingId = titleId || 'modal-title';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-fg/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full rounded-card bg-card shadow-2xl border border-border animate-scale-in max-h-[90vh] flex flex-col outline-none',
          WIDTHS[size]
        )}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border/60">
            <div>
              {title && <h2 id={headingId} className="text-base font-semibold text-fg">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="text-fg-subtle hover:text-fg rounded-md p-1 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
