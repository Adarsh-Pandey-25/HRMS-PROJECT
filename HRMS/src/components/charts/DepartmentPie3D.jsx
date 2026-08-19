import { memo, useMemo, useState } from 'react';
import { CHART_PALETTE } from '../../lib/apexTheme';
import { useUIStore } from '../../store/uiStore';

const VIEW = 360;
const CX = VIEW / 2;
const CY = VIEW / 2;
const OUTER = 96;
const INNER = 52;
const LABEL_R = 128;

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function donutPath(startAngle, endAngle) {
  const sweep = Math.max(0.01, endAngle - startAngle);
  const large = sweep > 180 ? 1 : 0;
  const [sx, sy] = polar(CX, CY, OUTER, startAngle);
  const [ex, ey] = polar(CX, CY, OUTER, startAngle + sweep);
  const [isx, isy] = polar(CX, CY, INNER, startAngle);
  const [iex, iey] = polar(CX, CY, INNER, startAngle + sweep);
  return [
    `M ${sx} ${sy}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${ex} ${ey}`,
    `L ${iex} ${iey}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${isx} ${isy}`,
    'Z',
  ].join(' ');
}

function fullRingPath() {
  return [
    `M ${CX} ${CY - OUTER}`,
    `A ${OUTER} ${OUTER} 0 1 1 ${CX} ${CY + OUTER}`,
    `A ${OUTER} ${OUTER} 0 1 1 ${CX} ${CY - OUTER}`,
    `M ${CX} ${CY - INNER}`,
    `A ${INNER} ${INNER} 0 1 0 ${CX} ${CY + INNER}`,
    `A ${INNER} ${INNER} 0 1 0 ${CX} ${CY - INNER}`,
    'Z',
  ].join(' ');
}

/**
 * Flat labeled donut matching the classic “By Department” dashboard chart:
 * outside names with leader lines, white counts on each slice, hover tooltip.
 */
function DepartmentPie3D({ data = [] }) {
  const isDark = useUIStore((s) => s.isDark);
  const [hovered, setHovered] = useState(null);

  const slices = useMemo(() => {
    const rows = (data || []).filter((d) => Number(d.value) > 0);
    const total = rows.reduce((s, d) => s + Number(d.value || 0), 0);
    if (!total) return { total: 0, items: [] };

    let angle = 0;
    const items = rows.map((d, i) => {
      const value = Number(d.value || 0);
      const sweep = (value / total) * 360;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      const mid = start + sweep / 2;
      return {
        name: d.name || 'Unassigned',
        value,
        start,
        end,
        mid,
        sweep,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
        share: value / total,
      };
    });
    return { total, items };
  }, [data]);

  const labelFill = isDark ? '#E5E7EB' : '#4B5563';
  const lineStroke = isDark ? '#6B7280' : '#D1D5DB';
  const sliceStroke = isDark ? '#1F2937' : '#FFFFFF';

  if (!slices.items.length) {
    return (
      <div className="h-[300px] md:h-[340px] flex items-center justify-center text-sm text-fg-subtle">
        No department data yet.
      </div>
    );
  }

  const active = hovered != null ? slices.items[hovered] : null;

  return (
    <div className="relative w-full h-[300px] md:h-[340px]">
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-full" role="img" aria-label="Employees by department">
        {slices.items.map((slice, i) => {
          const isFull = slice.sweep >= 359.9;
          const explode = hovered === i ? 6 : 0;
          const [ox, oy] = polar(0, 0, explode, slice.mid);
          return (
            <g
              key={slice.name}
              transform={`translate(${ox} ${oy})`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              className="cursor-pointer"
              opacity={hovered != null && hovered !== i ? 0.55 : 1}
            >
              <path
                d={isFull ? fullRingPath() : donutPath(slice.start, slice.end)}
                fill={slice.color}
                stroke={sliceStroke}
                strokeWidth={2}
              />
              {slice.sweep >= 14 && (
                <text
                  x={polar(CX, CY, (INNER + OUTER) / 2, slice.mid)[0]}
                  y={polar(CX, CY, (INNER + OUTER) / 2, slice.mid)[1]}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#FFFFFF"
                  fontSize="13"
                  fontWeight="700"
                  className="pointer-events-none"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  {slice.value}
                </text>
              )}
            </g>
          );
        })}

        {slices.items.map((slice) => {
          if (slice.sweep < 10) return null;
          const [rimX, rimY] = polar(CX, CY, OUTER + 4, slice.mid);
          const [labX, labY] = polar(CX, CY, LABEL_R, slice.mid);
          const right = Math.cos(((slice.mid - 90) * Math.PI) / 180) >= 0;
          const textX = labX + (right ? 8 : -8);
          return (
            <g key={`${slice.name}-label`} className="pointer-events-none">
              <polyline
                fill="none"
                stroke={lineStroke}
                strokeWidth="1"
                points={`${rimX},${rimY} ${labX},${labY}`}
              />
              <text
                x={textX}
                y={labY}
                textAnchor={right ? 'start' : 'end'}
                dominantBaseline="middle"
                fill={labelFill}
                fontSize="11"
                fontWeight="500"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {slice.name}
              </text>
            </g>
          );
        })}
      </svg>

      {active && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-card-hover whitespace-nowrap">
          <p className="font-semibold text-fg">{active.name}</p>
          <p className="text-fg-muted">
            {active.value} employees · {Math.round(active.share * 100)}%
          </p>
        </div>
      )}
    </div>
  );
}

export default memo(DepartmentPie3D);
