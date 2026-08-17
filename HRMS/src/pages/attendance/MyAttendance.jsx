import { useState, useMemo, useEffect } from 'react';
import { LogIn, LogOut, Clock, UserCheck, Home, UserX, CheckCircle2, MapPin } from 'lucide-react';
import { PageHeader, Card, Button, Modal, EmptyState, Skeleton } from '../../components/ui';
import { AttendanceCalendar } from '../../components/shared/AttendanceCalendar';
import { cn, formatDate } from '../../lib/utils';
import {
  useMyAttendance, useMonthlyAttendanceSummary, useAttendanceMutations, useCheckContext,
} from '../../hooks/useAttendance';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

const GOAL_HOURS = 9;
const GOAL_MS = GOAL_HOURS * 60 * 60 * 1000;

const STAT_CARDS = [
  { key: 'present', label: 'Present', tone: 'text-success', icon: UserCheck, filter: (a) => a.status !== 'wfh' && ['present', 'late', 'early_departure'].includes(a.status) },
  { key: 'wfh', label: 'WFH', tone: 'text-primary', icon: Home, filter: (a) => a.status === 'wfh' },
  { key: 'late', label: 'Late', tone: 'text-warning', icon: Clock, filter: (a) => a.status === 'late' },
  { key: 'absent', label: 'Absent', tone: 'text-danger', icon: UserX, filter: (a) => a.status === 'absent' },
  { key: 'avgHours', label: 'Avg hours', tone: 'text-fg', icon: Clock, filter: (a) => a.workHours > 0, sort: (a, b) => b.workHours - a.workHours },
  { key: 'overtime', label: 'Overtime', tone: 'text-teal', icon: CheckCircle2, filter: (a) => a.overtime > 0, sort: (a, b) => b.overtime - a.overtime },
];

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatClockLabel(timeStr) {
  if (!timeStr) return '—';
  return timeStr.length >= 5 ? timeStr.slice(0, 5) : timeStr;
}

export default function MyAttendance() {
  const now = new Date();
  // Use Asia/Kolkata for month bounds so they match attendance dates
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const [yStr, mStr] = todayStr.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const monthStart = `${yStr}-${mStr}-01`;
  const monthEnd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.UTC(year, month, 0)) // day 0 of next month = last day of `month`
  );

  const { data: records = [], isLoading: loadingRecords, refetch: refetchMy } = useMyAttendance({ from: monthStart, to: monthEnd });
  const { data: monthly, isLoading: loadingSummary } = useMonthlyAttendanceSummary({ month, year });
  const { data: checkContext, refetch: refetchContext } = useCheckContext();
  const { checkIn, checkOut, requestWfh, cancelWfh } = useAttendanceMutations();
  const role = useAuthStore((s) => s.role);
  const canRequestDailyWfh = role !== 'admin' && role !== 'hr';

  const [tick, setTick] = useState(Date.now());
  const [activeStat, setActiveStat] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Prefer live check-context session (fixes "Already checked in" while UI shows Clock In)
  const todayRecord = useMemo(() => {
    if (checkContext?.today?.checkIn || checkContext?.today?.checkInAt) {
      return checkContext.today;
    }
    const fromList = records.find((a) => a.date === todayStr);
    if (fromList) return fromList;
    return (monthly?.records || []).find((a) => a.date === todayStr) || null;
  }, [checkContext?.today, records, monthly?.records, todayStr]);

  const clockedIn = Boolean(
    checkContext?.today?.isOpen
    ?? (todayRecord?.checkIn && !todayRecord?.checkOut)
  );
  const checkInTime = todayRecord?.checkIn || null;
  const checkOutTime = todayRecord?.checkOut || null;

  const permanentWfh = checkContext?.attendanceMode === 'wfh';
  const dailyWfhStatus = checkContext?.dailyWfhStatus || null;
  const wfhApproved = Boolean(checkContext?.dailyWfhApproved || permanentWfh);
  const wfhPending = dailyWfhStatus === 'pending';
  const wfhRejected = dailyWfhStatus === 'rejected';
  const todayIsWfh = Boolean(todayRecord?.status === 'wfh' || todayRecord?.isWfh || wfhApproved);
  const showWfhControls = canRequestDailyWfh && !clockedIn && !todayRecord?.checkOut && !permanentWfh;

  const goalTimer = useMemo(() => {
    void tick;
    if (clockedIn && todayRecord?.checkInAt) {
      const start = new Date(todayRecord.checkInAt).getTime();
      const elapsed = Math.max(0, Date.now() - start);
      const remaining = Math.max(0, GOAL_MS - elapsed);
      const progress = Math.min(100, (elapsed / GOAL_MS) * 100);
      const overtime = Math.max(0, elapsed - GOAL_MS);
      return {
        mode: 'running',
        display: formatDuration(elapsed),
        remaining: formatDuration(remaining),
        progress,
        overtime,
        label: overtime > 0 ? 'Overtime' : 'Toward 9h goal',
        sub: overtime > 0
          ? `+${formatDuration(overtime)} past goal`
          : `${formatDuration(remaining)} left`,
      };
    }
    if (todayRecord?.checkOut && todayRecord.workHours != null) {
      const workedMs = Number(todayRecord.workHours) * 3600 * 1000;
      const progress = Math.min(100, (workedMs / GOAL_MS) * 100);
      return {
        mode: 'done',
        display: formatDuration(workedMs),
        remaining: formatDuration(Math.max(0, GOAL_MS - workedMs)),
        progress,
        overtime: Number(todayRecord.overtime || 0) * 3600 * 1000,
        label: 'Hours worked today',
        sub: Number(todayRecord.workHours) >= GOAL_HOURS
          ? `Goal met · ${GOAL_HOURS}h`
          : `${(GOAL_HOURS - Number(todayRecord.workHours)).toFixed(1)}h short of goal`,
      };
    }
    return {
      mode: 'idle',
      display: '00:00:00',
      remaining: formatDuration(GOAL_MS),
      progress: 0,
      overtime: 0,
      label: `${GOAL_HOURS}h work goal`,
      sub: 'Clock in to start the timer',
    };
  }, [tick, clockedIn, todayRecord]);

  const myAttendanceSummary = monthly?.summary || {
    present: 0, wfh: 0, late: 0, absent: 0, avgHours: 0, overtime: 0,
  };

  const statusByDay = useMemo(() => {
    const map = {};
    const all = [...records, ...(monthly?.records || [])];
    all.forEach((a) => {
      if (!a.date) return;
      const day = Number(a.date.split('-')[2]);
      map[day] = a.status === 'early_departure' ? 'present' : a.status;
    });
    return map;
  }, [records, monthly?.records]);

  const ipAllowed = checkContext?.canCheckInFromThisIp !== false;
  const ipEnforced = checkContext?.officeIpRequired !== false && checkContext?.ipRequiredForWeb !== false;
  const privilegedAttendance = role === 'admin' || role === 'hr';
  const canClockIn = privilegedAttendance || !ipEnforced || ipAllowed || wfhApproved;

  const handleRequestWfh = async () => {
    try {
      await requestWfh.mutateAsync({ reason: 'Working from home today' });
      toast.success('WFH request sent — waiting for Manager/HR approval');
      await refetchContext();
    } catch (err) {
      toast.error(err.message || 'Failed to request WFH');
    }
  };

  const handleCancelWfh = async () => {
    if (!checkContext?.dailyWfhRequestId) return;
    try {
      await cancelWfh.mutateAsync(checkContext.dailyWfhRequestId);
      toast.success('WFH request cancelled');
      await refetchContext();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel request');
    }
  };

  /** Web-only check-in (desktop or phone browser) — office IP is the only gate. */
  const handleClock = async () => {
    try {
      if (clockedIn) {
        await checkOut.mutateAsync({ method: 'web' });
        toast.success('Clocked out successfully');
      } else {
        if (!canClockIn) {
          toast.error(
            wfhPending
              ? 'WFH request is still pending Manager/HR approval'
              : canRequestDailyWfh
                ? `Check-in blocked — your IP (${checkContext?.clientIp}) is not on the approved network. Request WFH for today (needs Manager/HR approval).`
                : `Check-in blocked — your IP (${checkContext?.clientIp}) is not on the approved network.`
          );
          return;
        }
        await checkIn.mutateAsync({ method: 'web', is_wfh: Boolean(wfhApproved) });
        toast.success(
          wfhApproved
            ? 'Clocked in as WFH — 9h goal timer started'
            : 'Clocked in — 9h goal timer started'
        );
      }
      await Promise.all([refetchContext(), refetchMy()]);
    } catch (err) {
      const msg = err.message || 'Attendance action failed';
      if (/already checked in/i.test(msg)) {
        await Promise.all([refetchContext(), refetchMy()]);
        toast.error('You are already checked in — use Clock Out');
        return;
      }
      toast.error(msg);
    }
  };

  const isLoading = loadingRecords || loadingSummary;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My Attendance" subtitle="Track your time, presence and overtime" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-6 flex flex-col items-center justify-center text-center bg-gradient-to-br from-primary/5 to-transparent">
          <p className="text-xs text-fg-subtle">{formatDate(now, 'EEEE, d MMMM yyyy')}</p>

          <p className="text-[11px] uppercase tracking-wide text-fg-subtle mt-3">{goalTimer.label}</p>
          <p className="text-4xl font-semibold text-fg tabular-nums my-1">{goalTimer.display}</p>
          <p className="text-xs text-fg-muted mb-3">{goalTimer.sub}</p>

          <div className="w-full max-w-[240px] h-2 rounded-full bg-muted overflow-hidden mb-4">
            <div
              className={cn('h-full rounded-full transition-all', goalTimer.overtime > 0 ? 'bg-teal' : 'bg-primary')}
              style={{ width: `${goalTimer.progress}%` }}
            />
          </div>

          <div className="flex items-center gap-3 mb-4 w-full max-w-[240px]">
            <div className="flex-1 rounded-xl bg-muted/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-fg-subtle">Check-in</p>
              <p className="text-sm font-semibold text-success tabular-nums">{formatClockLabel(checkInTime)}</p>
            </div>
            <div className="flex-1 rounded-xl bg-muted/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-fg-subtle">Check-out</p>
              <p className="text-sm font-semibold text-danger tabular-nums">{formatClockLabel(checkOutTime)}</p>
            </div>
          </div>

          {showWfhControls && (
            <div className="w-full max-w-[280px] mb-4 rounded-xl border border-border bg-background px-3 py-2.5 text-left space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-fg">Today on WFH</p>
                  <p className="text-[11px] text-fg-subtle">
                    {wfhApproved
                      ? 'Approved by Manager/HR'
                      : wfhPending
                        ? 'Waiting for Manager/HR approval'
                        : wfhRejected
                          ? 'Rejected — you can request again'
                          : 'Requires Manager or HR approval'}
                  </p>
                </div>
                {wfhApproved ? (
                  <span className="text-[11px] font-semibold text-success shrink-0">Approved</span>
                ) : wfhPending ? (
                  <span className="text-[11px] font-semibold text-warning shrink-0">Pending</span>
                ) : null}
              </div>
              {!wfhApproved && !wfhPending && (
                <Button size="sm" className="w-full" onClick={handleRequestWfh} loading={requestWfh.isPending} disabled={requestWfh.isPending}>
                  Request WFH for today
                </Button>
              )}
              {wfhPending && (
                <Button size="sm" variant="outline" className="w-full" onClick={handleCancelWfh} loading={cancelWfh.isPending} disabled={cancelWfh.isPending}>
                  Cancel request
                </Button>
              )}
            </div>
          )}

          {(permanentWfh || (todayRecord && todayIsWfh) || wfhApproved) && !showWfhControls && (
            <p className="flex items-center gap-1.5 text-[11px] text-info mb-3">
              <Home className="h-3 w-3 shrink-0" />
              {permanentWfh ? 'WFH employee' : 'Checked in as WFH today'}
            </p>
          )}

          <Button
            variant={clockedIn ? 'danger' : 'primary'}
            icon={clockedIn ? LogOut : LogIn}
            onClick={handleClock}
            size="lg"
            disabled={checkIn.isPending || checkOut.isPending || (!clockedIn && !canClockIn)}
            loading={checkIn.isPending || checkOut.isPending}
          >
            {clockedIn ? 'Clock Out' : wfhApproved ? 'Clock In (WFH)' : 'Clock In'}
          </Button>

          {checkContext && (
            <p className={cn(
              'flex items-center gap-1.5 text-[11px] mt-4',
              permanentWfh || privilegedAttendance || wfhApproved
                ? 'text-info'
                : wfhPending
                  ? 'text-warning'
                  : (ipAllowed ? 'text-success' : 'text-danger')
            )}>
              <MapPin className="h-3 w-3 shrink-0" />
              {permanentWfh
                ? 'WFH mode — check-in allowed from any network'
                : privilegedAttendance
                  ? 'HR/Admin — check-in allowed from any network'
                : wfhApproved
                  ? 'WFH approved — office IP not required today'
                  : wfhPending
                    ? 'WFH pending approval — office IP still required'
                    : `${checkContext.clientIp || 'IP unknown'}${(checkContext.clientIps || []).length > 1 ? ` (${checkContext.clientIps.filter((ip) => ip !== checkContext.clientIp).join(', ')})` : ''} · ${ipAllowed ? 'office IP OK' : `office IP required (${checkContext.officeCidr || 'whitelist'})`}`}
            </p>
          )}
        </Card>

        <Card className="lg:col-span-2 p-5">
          <p className="text-sm font-semibold text-fg mb-4">This month&apos;s summary</p>
          {isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {STAT_CARDS.map(({ key, label, tone, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveStat(key)}
                  className="rounded-xl bg-muted/50 p-3 text-left hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Icon className={cn('h-4 w-4 mb-2', tone)} />
                  <p className={cn('text-xl font-semibold tabular-nums', tone)}>
                    {key === 'avgHours' ? `${myAttendanceSummary.avgHours}h` : key === 'overtime' ? `${myAttendanceSummary.overtime}h` : myAttendanceSummary[key]}
                  </p>
                  <p className="text-xs text-fg-subtle">{label}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <AttendanceCalendar year={year} month={month - 1} statusByDay={statusByDay} today={now.getDate()} />
      </Card>

      {activeStat && (() => {
        const stat = STAT_CARDS.find((s) => s.key === activeStat);
        const days = records.filter(stat.filter).sort(stat.sort || ((a, b) => a.date.localeCompare(b.date)));
        return (
          <Modal open onClose={() => setActiveStat(null)} title={`${stat.label} — this month`} subtitle={`${days.length} day${days.length === 1 ? '' : 's'}`}>
            {days.length === 0 ? (
              <EmptyState icon={stat.icon} title={`No ${stat.label.toLowerCase()} days`} message="Nothing to show for this stat yet." />
            ) : (
              <div className="space-y-1.5">
                {days.map((a) => (
                  <div key={a.id || a.date} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-medium text-fg">{formatDate(a.date, 'EEE, d MMM')}</span>
                    <span className="text-fg-muted tabular-nums">
                      {a.checkIn ? `${formatClockLabel(a.checkIn)} – ${formatClockLabel(a.checkOut)}` : '—'}
                    </span>
                    <span className={cn('font-semibold tabular-nums', stat.tone)}>
                      {activeStat === 'overtime' ? `+${a.overtime}h OT` : `${a.workHours}h`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}
