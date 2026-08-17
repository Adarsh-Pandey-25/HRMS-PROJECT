import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card } from './Card';

const ICON_TONES = {
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  teal: 'bg-teal/12 text-teal',
};

export function StatCard({ label, value, icon: Icon, tone = 'primary', delta, deltaLabel, footer, className, to, onClick, active }) {
  const positive = delta > 0;
  const negative = delta < 0;
  const interactive = Boolean(to || onClick);

  const body = (
    <Card
      hover={interactive}
      className={cn(
        'p-5 h-full',
        interactive && 'transition-colors hover:border-primary/35 cursor-pointer',
        active && 'border-primary ring-2 ring-primary/20',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-subtle">{label}</p>
          <p className="mt-2 text-kpi text-fg tabular-nums">{value}</p>
        </div>
        {Icon && (
          <div className={cn('h-11 w-11 rounded-xl flex items-center justify-center shrink-0', ICON_TONES[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {(delta != null || footer) && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          {delta != null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                positive && 'text-success',
                negative && 'text-danger',
                !positive && !negative && 'text-fg-muted'
              )}
            >
              {positive && <ArrowUpRight className="h-3.5 w-3.5" />}
              {negative && <ArrowDownRight className="h-3.5 w-3.5" />}
              {Math.abs(delta)}%
            </span>
          )}
          <span className="text-fg-subtle">{deltaLabel || footer}</span>
        </div>
      )}
    </Card>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`${label} — filter list`}
        aria-pressed={active}
      >
        {body}
      </button>
    );
  }

  if (!to) return body;

  return (
    <Link
      to={to}
      className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      aria-label={`${label} — view details`}
    >
      {body}
    </Link>
  );
}
