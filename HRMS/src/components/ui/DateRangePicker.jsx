import { Field } from './Input';
import { cn } from '../../lib/utils';

const inputCls =
  'h-10 rounded-input bg-card border border-border px-3 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

export function DateRangePicker({ from, to, onFromChange, onToChange, label, error, required, className }) {
  return (
    <Field label={label} error={error} required={required} className={className}>
      <div className="flex items-center gap-2">
        <input type="date" value={from || ''} onChange={(e) => onFromChange?.(e.target.value)} className={cn(inputCls, 'flex-1')} />
        <span className="text-fg-subtle text-sm">→</span>
        <input type="date" value={to || ''} min={from} onChange={(e) => onToChange?.(e.target.value)} className={cn(inputCls, 'flex-1')} />
      </div>
    </Field>
  );
}
