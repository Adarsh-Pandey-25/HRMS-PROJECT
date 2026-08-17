import { cn } from '../../lib/utils';

/** Simple on/off switch used across Settings forms. */
export function Toggle({ checked, onChange, disabled, label, hint, className }) {
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
        )}
        style={{ height: '18px', width: '18px' }}
      />
    </button>
  );

  if (!label && !hint) return <div className={className}>{switchEl}</div>;

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div>
        {label && <p className="text-sm font-medium text-fg">{label}</p>}
        {hint && <p className="text-xs text-fg-subtle mt-0.5">{hint}</p>}
      </div>
      {switchEl}
    </div>
  );
}
