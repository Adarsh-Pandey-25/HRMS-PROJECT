import { cn } from '../../lib/utils';

/**
 * Controlled tabs.
 * tabs: [{ id, label, icon?, count? }]
 */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-border overflow-x-auto no-scrollbar', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'text-primary' : 'text-fg-muted hover:text-fg'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  'rounded-pill px-1.5 py-0.5 text-[10px] font-semibold',
                  active ? 'bg-primary/12 text-primary' : 'bg-muted text-fg-subtle'
                )}
              >
                {t.count}
              </span>
            )}
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pill-style segmented control (for view toggles / sub-filters). */
export function SegmentedControl({ options, value, onChange, className }) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-input bg-muted p-1', className)}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const Icon = typeof o === 'object' ? o.icon : null;
        const active = val === value;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              active ? 'bg-card text-primary shadow-sm' : 'text-fg-muted hover:text-fg'
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
