import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { Card, CardHeader, Badge, Select, Input, Skeleton, EmptyState, Button } from '../ui';
import { ExportButton } from '../shared/ExportButton';
import { AttendanceCalendar } from '../shared/AttendanceCalendar';
import { useEmployeeAttendanceReport } from '../../hooks/useAttendance';
import { formatDate, cn } from '../../lib/utils';

/**
 * An employee's attendance over any range: the profile's Attendance tab.
 * One row per day — worked days from the records, plus absent, leave and
 * holiday days from the server's summary (weekly offs are left out), with
 * the same counts as Reports. The server starts the range no earlier than
 * the person's first tracked day, so "All time" never shows absences from
 * before they were on SpaxSync.
 */

// The server's limit (attendance.service.js MAX_REPORT_DAYS).
const MAX_DAYS = 1100;
const PAGE_SIZE = 60;

const PRESETS = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'last-6-months', label: 'Last 6 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom dates' },
];

const STATUS = {
  present: { label: 'Present', tone: 'success' },
  late: { label: 'Late', tone: 'warning' },
  wfh: { label: 'WFH', tone: 'primary' },
  // Checked in while the WFH request waited: counts once it is approved.
  wfh_pending: { label: 'WFH · awaiting approval', tone: 'warning' },
  half_day: { label: 'Half day', tone: 'info' },
  absent: { label: 'Absent', tone: 'danger' },
  // A check-in taken out because its WFH request was rejected or cancelled.
  voided: { label: 'Not counted', tone: 'danger' },
  leave: { label: 'On leave', tone: 'teal' },
  holiday: { label: 'Holiday', tone: 'neutral' },
};
const STATUS_FILTERS = [{ value: 'all', label: 'All days' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))];
const METHOD = { biometric: 'Biometric', web: 'Web', app: 'App', manual: 'Manual', office_ip: 'Web' };
// AttendanceCalendar's names for the same statuses.
const CALENDAR_STATUS = { half_day: 'half-day', wfh_pending: 'wfh', voided: 'absent' };
const clockTime = (iso) => (iso
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))
  : null);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const daysBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000);

/** [from, to] of a preset, as YYYY-MM-DD. */
const presetRange = (preset) => {
  const today = new Date();
  const monthStart = (back) => new Date(today.getFullYear(), today.getMonth() - back, 1);
  switch (preset) {
    case 'last-month': return [ymd(monthStart(1)), ymd(new Date(today.getFullYear(), today.getMonth(), 0))];
    case 'last-3-months': return [ymd(monthStart(2)), ymd(today)];
    case 'last-6-months': return [ymd(monthStart(5)), ymd(today)];
    case 'this-year': return [ymd(new Date(today.getFullYear(), 0, 1)), ymd(today)];
    case 'all': return [ymd(new Date(today.getTime() - (MAX_DAYS - 1) * 86400000)), ymd(today)];
    default: return [ymd(monthStart(0)), ymd(today)];
  }
};

/** A record's day status, as the history shows it. */
const recordStatus = (r) => {
  if (r.wfhPending) return 'wfh_pending';
  if (r.isWfh) return 'wfh';
  if (r.status === 'half_day') return 'half_day';
  if (r.isLate || r.status === 'late') return 'late';
  if (r.status === 'absent') return 'absent';
  return 'present';
};

export function EmployeeAttendanceHistory({ employeeId, initialFrom, initialTo }) {
  // Opened with a range (Team Attendance, Reports): show exactly that range.
  const fromUrl = isDay(initialFrom) && isDay(initialTo);
  const [preset, setPreset] = useState(fromUrl ? 'custom' : 'this-month');
  const [custom, setCustom] = useState(() => (fromUrl ? [initialFrom, initialTo] : presetRange('this-month')));
  const [statusFilter, setStatusFilter] = useState('all');
  const [shown, setShown] = useState(PAGE_SIZE);

  const [from, to] = preset === 'custom' ? custom : presetRange(preset);
  const rangeError = !isDay(from) || !isDay(to)
    ? 'Pick both dates.'
    : from > to
      ? 'The start date must be on or before the end date.'
      : daysBetween(from, to) > MAX_DAYS - 1
        ? `Pick a range of at most ${MAX_DAYS} days.`
        : null;

  const { data, isLoading, error } = useEmployeeAttendanceReport(rangeError ? undefined : employeeId, { from, to });
  const records = useMemo(() => data?.records ?? [], [data?.records]);
  const summary = data?.summary;

  const rows = useMemo(() => {
    const list = records.map((r) => ({
      key: r.id,
      date: r.date,
      status: recordStatus(r),
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      hours: r.workHours,
      method: METHOD[r.checkInMethod] || r.checkInMethod || '—',
      autoCheckout: r.isAutoCheckout,
    }));
    // A voided check-in shows on its day instead of a bare "Absent" (the day
    // still counts as absent in the totals).
    for (const v of data?.voidedCheckIns || []) {
      list.push({
        key: `voided-${v.date}-${v.checkInAt}`,
        date: v.date,
        status: 'voided',
        label: v.requestStatus === 'cancelled' ? 'Not counted — WFH cancelled' : 'Not counted — WFH rejected',
        checkIn: clockTime(v.checkInAt),
        checkOut: clockTime(v.checkOutAt),
      });
    }
    const covered = new Set(list.map((r) => r.date));
    const addDays = (dates, status) => (dates || []).forEach((date) => {
      if (!covered.has(date)) list.push({ key: `${status}-${date}`, date, status });
    });
    addDays(summary?.absentDates, 'absent');
    addDays(summary?.leaveDates, 'leave');
    addDays(summary?.holidayDates, 'holiday');
    return list.sort((a, b) => b.date.localeCompare(a.date) || String(b.checkIn || '').localeCompare(String(a.checkIn || '')));
  }, [records, summary, data?.voidedCheckIns]);

  const visible = statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter);
  const counts = useMemo(() => rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}), [rows]);

  // A one-month range also shows as a calendar.
  const oneMonth = isDay(from) && isDay(to) && from.slice(0, 7) === to.slice(0, 7);
  const calendar = useMemo(() => {
    if (!oneMonth) return null;
    const statusByDay = {};
    for (const r of [...rows].reverse()) {
      const day = Number(r.date.slice(8, 10));
      if (!statusByDay[day] || r.checkIn) statusByDay[day] = CALENDAR_STATUS[r.status] || r.status;
    }
    const now = new Date();
    const year = Number(from.slice(0, 4));
    const month = Number(from.slice(5, 7)) - 1;
    return { year, month, statusByDay, today: now.getFullYear() === year && now.getMonth() === month ? now.getDate() : null };
  }, [oneMonth, rows, from]);

  const startsLater = data?.from && data.from > from;
  const exportRows = visible.map((r) => ({
    date: r.date,
    day: formatDate(r.date, 'EEE'),
    status: r.label || STATUS[r.status]?.label || r.status,
    check_in: r.checkIn || '',
    check_out: r.checkOut || '',
    hours: r.hours ? Number(r.hours).toFixed(2) : '',
    method: r.checkIn ? r.method : '',
  }));

  const pickPreset = (value) => {
    if (value === 'custom' && preset !== 'custom') setCustom([from, to]);
    setPreset(value);
    setShown(PAGE_SIZE);
  };

  const tiles = [
    ['Present', summary?.present, 'text-success'],
    ['WFH', summary?.wfh, 'text-primary'],
    ['Late', summary?.late, 'text-warning'],
    ['Half day', summary?.halfDay, 'text-info'],
    ['Absent', summary?.absent, 'text-danger'],
    ['On leave', summary?.leaveDates?.length, 'text-teal'],
    ['Holidays', summary?.holidayDates?.length, 'text-fg'],
    ['Avg hours', summary?.avgHours, 'text-fg'],
    // Not counted in the totals until the WFH request is approved.
    ...(summary?.awaitingApproval ? [['Awaiting approval', summary.awaitingApproval, 'text-warning']] : []),
  ];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Select label="Period" containerClass="lg:w-48" value={preset} onChange={(e) => pickPreset(e.target.value)} options={PRESETS} />
          {preset === 'custom' && (
            <>
              <Input label="From" type="date" containerClass="lg:w-44" value={custom[0]} max={custom[1] || undefined} onChange={(e) => { setCustom([e.target.value, custom[1]]); setShown(PAGE_SIZE); }} />
              <Input label="To" type="date" containerClass="lg:w-44" value={custom[1]} min={custom[0] || undefined} onChange={(e) => { setCustom([custom[0], e.target.value]); setShown(PAGE_SIZE); }} />
            </>
          )}
          <Select label="Show" containerClass="lg:w-44" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setShown(PAGE_SIZE); }} options={STATUS_FILTERS} />
          <div className="lg:ml-auto">
            <ExportButton
              rows={exportRows}
              filename={`attendance-${from}-to-${to}`}
              title="Attendance history"
              columns={['date', 'day', 'status', 'check_in', 'check_out', 'hours', 'method']}
            />
          </div>
        </div>
        {rangeError && <p className="mt-2 text-xs text-danger">{rangeError}</p>}
        {!rangeError && (
          <p className="mt-2 text-xs text-fg-subtle">
            {formatDate(data?.from || from, 'dd MMM yyyy')} – {formatDate(to, 'dd MMM yyyy')}
            {startsLater && ' · starts on the first day this person was tracked in SpaxSync'}
          </p>
        )}
      </Card>

      {isLoading && !rangeError ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : error ? (
        <Card className="p-5"><p className="text-sm text-danger">{error.message || 'Could not load attendance.'}</p></Card>
      ) : !rangeError && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
            {tiles.map(([label, value, tone]) => (
              <Card key={label} className="p-3">
                <p className="text-xs text-fg-subtle">{label}</p>
                <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone)}>{value ?? 0}</p>
              </Card>
            ))}
          </div>

          {calendar && rows.length > 0 && (
            <Card className="p-5">
              <AttendanceCalendar year={calendar.year} month={calendar.month} statusByDay={calendar.statusByDay} today={calendar.today} />
            </Card>
          )}

          <Card>
            <CardHeader
              title="Day by day"
              subtitle={`${visible.length} ${visible.length === 1 ? 'day' : 'days'}${statusFilter === 'all' ? '' : ` · ${STATUS[statusFilter]?.label}`}`}
            />
            {visible.length === 0 ? (
              <EmptyState icon={Clock} title="No attendance in this period" message="Pick another period, or All days under Show." />
            ) : (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['Date', 'Status', 'Check-in', 'Check-out', 'Hours', 'Method'].map((h) => (
                        <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice(0, shown).map((r) => (
                      <tr key={r.key} className="border-b border-border/50">
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <span className="font-medium text-fg">{formatDate(r.date, 'dd MMM yyyy')}</span>
                          <span className="ml-2 text-xs text-fg-subtle">{formatDate(r.date, 'EEE')}</span>
                        </td>
                        <td className="py-2.5 pr-3"><Badge tone={STATUS[r.status]?.tone || 'neutral'}>{r.label || STATUS[r.status]?.label || r.status}</Badge></td>
                        <td className="py-2.5 pr-3 tabular-nums">{r.checkIn || '—'}</td>
                        <td className="py-2.5 pr-3 tabular-nums">
                          {r.checkOut || (r.checkIn ? <span className="text-xs text-fg-subtle">Not checked out</span> : '—')}
                          {r.autoCheckout && <span className="ml-1 text-xs text-fg-subtle">(auto)</span>}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums">{r.hours ? `${Number(r.hours).toFixed(1)}h` : '—'}</td>
                        <td className="py-2.5 pr-3 text-fg-muted">{r.checkIn && r.method ? r.method : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length > shown && (
                  <div className="pt-4 text-center">
                    <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                      Show more ({visible.length - shown} left)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
          {statusFilter === 'all' && rows.length > 0 && (
            <p className="text-xs text-fg-subtle">
              {Object.entries(counts).map(([status, n]) => `${STATUS[status]?.label || status}: ${n}`).join(' · ')}
              {' '}· Weekly offs are not listed.
            </p>
          )}
        </>
      )}
    </div>
  );
}
