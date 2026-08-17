import { cn } from '../../lib/utils';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const STATUS_STYLE = {
  present: 'bg-success/15 text-success',
  wfh: 'bg-primary/15 text-primary',
  late: 'bg-warning/20 text-warning',
  absent: 'bg-danger/15 text-danger',
  'half-day': 'bg-info/15 text-info',
  'on-leave': 'bg-primary/15 text-primary',
  leave: 'bg-primary/15 text-primary',
  holiday: 'bg-fg-subtle/15 text-fg-muted',
  weekend: 'bg-transparent text-fg-subtle/50',
};

const LEGEND = [
  ['present', 'Present'],
  ['wfh', 'WFH'],
  ['late', 'Late'],
  ['absent', 'Absent'],
  ['leave', 'Leave'],
  ['holiday', 'Holiday'],
];

/**
 * statusByDay: { [dayNumber]: 'present' | 'absent' | ... }
 * month is 0-based.
 */
export function AttendanceCalendar({ year, month, statusByDay = {}, today }) {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div>
      <p className="text-sm font-semibold text-fg mb-3">{MONTHS[month]} {year}</p>
      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          <div key={d} className="text-[10px] font-semibold text-fg-subtle text-center pb-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const status = statusByDay[day];
          const isToday = day === today;
          return (
            <div
              key={i}
              className={cn(
                'aspect-square rounded-lg flex flex-col items-center justify-center text-xs relative',
                status ? STATUS_STYLE[status] : 'bg-muted/40 text-fg-muted',
                isToday && 'ring-2 ring-primary'
              )}
            >
              <span className="font-medium">{day}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {LEGEND.map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={cn('h-3 w-3 rounded', STATUS_STYLE[key])} />
            <span className="text-xs text-fg-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
