import { cn, clamp } from '../../lib/utils';

const TONES = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  teal: 'bg-teal',
};

export function ProgressBar({ value = 0, tone = 'primary', className, showLabel = false, size = 'md' }) {
  const pct = clamp(value, 0, 100);
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('flex-1 rounded-pill bg-muted overflow-hidden', h)}>
        <div
          className={cn('h-full rounded-pill transition-all duration-500', TONES[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && <span className="text-xs font-medium text-fg-muted tabular-nums w-9 text-right">{Math.round(pct)}%</span>}
    </div>
  );
}

export function ProgressRing({ value = 0, size = 72, stroke = 7, tone = '#6C63FF', label, sublabel }) {
  const pct = clamp(value, 0, 100);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={tone}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-semibold text-fg tabular-nums">{label ?? `${Math.round(pct)}%`}</span>
        {sublabel && <span className="text-[10px] text-fg-subtle">{sublabel}</span>}
      </div>
    </div>
  );
}
