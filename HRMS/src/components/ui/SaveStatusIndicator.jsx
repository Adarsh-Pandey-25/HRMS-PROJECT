import { Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Item 4: pairs with useAutosave's status state machine. Renders nothing
 * at rest (`idle`) so it never adds visual noise to a form nobody's
 * touched — only appears while actively saving, briefly on success, or
 * persistently on failure until retried.
 */
export function SaveStatusIndicator({ status, onRetry, className }) {
  if (status === 'idle' || !status) return null;

  if (status === 'saving') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-fg-subtle animate-fade-in', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }

  if (status === 'saved') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-success animate-fade-in', className)}>
        <Check className="h-3.5 w-3.5" /> Saved
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-danger animate-fade-in', className)}>
      <AlertCircle className="h-3.5 w-3.5" /> Failed to save
      <button type="button" onClick={onRetry} className="underline font-medium hover:no-underline">
        Retry
      </button>
    </span>
  );
}
