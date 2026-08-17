import { formatNumber } from '../../lib/utils';

/** Themed tooltip shared by all Recharts charts. */
export function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-card border border-border shadow-card-hover px-3 py-2 text-xs">
      {label != null && (
        <p className="font-semibold text-fg mb-1">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
            <span className="text-fg-muted capitalize">{p.name}</span>
            <span className="font-medium text-fg ml-auto tabular-nums">
              {formatter ? formatter(p.value, p.name) : formatNumber(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const axisProps = {
  tick: { fontSize: 11, fill: 'rgb(var(--color-text-muted))' },
  axisLine: false,
  tickLine: false,
};

export const gridProps = {
  strokeDasharray: '3 3',
  stroke: 'rgb(var(--color-border))',
  vertical: false,
};
