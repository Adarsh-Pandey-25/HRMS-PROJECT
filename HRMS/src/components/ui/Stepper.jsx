import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

/** steps: [{ label }]; current is 0-based index. */
export function Stepper({ steps, current }) {
  return (
    <div className="flex items-center w-full">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className={cn('flex items-center', i < steps.length - 1 && 'flex-1')}>
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all',
                  done && 'bg-primary text-white',
                  active && 'bg-primary/12 text-primary ring-2 ring-primary',
                  !done && !active && 'bg-muted text-fg-subtle'
                )}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-[11px] font-medium whitespace-nowrap',
                  active ? 'text-primary' : done ? 'text-fg-muted' : 'text-fg-subtle'
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn('flex-1 h-0.5 mx-2 mb-5 rounded-full transition-colors', done ? 'bg-primary' : 'bg-muted')} />
            )}
          </div>
        );
      })}
    </div>
  );
}
