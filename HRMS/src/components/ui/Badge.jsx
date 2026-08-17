import { cn } from '../../lib/utils';
import { STATUS_TONE } from '../../lib/constants';
import { humanize } from '../../lib/utils';

const TONES = {
  neutral: 'bg-fg-subtle/15 text-fg-muted',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  danger: 'bg-danger/12 text-danger',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/12 text-info',
  teal: 'bg-teal/12 text-teal',
};

export function Badge({ tone = 'neutral', children, className, dot = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone] || TONES.neutral,
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Auto-toned badge from a status string (uses STATUS_TONE map). */
export function StatusBadge({ status, label, dot = true, className }) {
  const tone = STATUS_TONE[status] || 'neutral';
  return (
    <Badge tone={tone} dot={dot} className={className}>
      {label || humanize(status || '')}
    </Badge>
  );
}
