import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarOff, Receipt, LifeBuoy, LogIn, LogOut, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, StatCard, Button, StatusBadge, ProgressBar, Skeleton } from '../../components/ui';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useAttendanceMutations } from '../../hooks/useAttendance';
import { MOODS } from '../../data';
import { useWellnessStore, getWellnessToday } from '../../store/wellnessStore';
import { formatDate, formatCurrency, cn } from '../../lib/utils';
import { leaveTypeLabel } from '../../lib/mappers';
import { Greeting, RecentAnnouncements } from './shared';

export default function EmployeeDashboard({ user }) {
  const { data: api, isLoading } = useDashboardData();
  const { checkIn, checkOut } = useAttendanceMutations();

  const todayKey = getWellnessToday();
  const todayMood = useWellnessStore((s) => s.myCheckins[todayKey]);
  const checkInMood = useWellnessStore((s) => s.checkIn);
  const handleMoodPick = (m) => {
    checkInMood(m.key);
    toast.success(`Thanks for checking in — feeling ${m.label.toLowerCase()} today.`);
  };

  const kpis = api?.kpis || {};
  const todayStatus = api?.todayStatus || {};
  const last7 = api?.last7Days || [];
  const leaveItems = api?.leaveBalances?.items || [];
  const latestPayslip = api?.latestPayslip;
  const openExpenses = api?.openExpenseClaims?.items || [];

  const checkedIn = todayStatus.status === 'checked_in';
  const canCheckIn = todayStatus.canCheckIn;
  const canCheckOut = todayStatus.canCheckOut;

  const totalRemaining = useMemo(
    () => leaveItems.reduce((sum, b) => sum + Number(b.available || 0), 0),
    [leaveItems]
  );

  const handleCheckInOut = async () => {
    try {
      if (canCheckOut) {
        await checkOut.mutateAsync({});
        toast.success('Checked out — see you tomorrow!');
      } else if (canCheckIn) {
        await checkIn.mutateAsync({ method: 'web' });
        toast.success('Checked in — have a great day!');
      }
    } catch (err) {
      toast.error(err.message || 'Attendance action failed');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Greeting user={user} dateLabel={api?.greeting?.date} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Attendance This Month" value={kpis.attendanceThisMonth ?? 0} icon={CalendarCheck} tone="success" footer="Days present" />
        <StatCard label="Leave Balance" value={totalRemaining} icon={CalendarOff} tone="warning" footer="Days remaining" />
        <StatCard label="Pending Expenses" value={kpis.pendingExpenses ?? 0} icon={Receipt} tone="info" footer="Claims in progress" />
        <StatCard label="Open Tickets" value={kpis.openTickets ?? 0} icon={LifeBuoy} tone="primary" footer="Awaiting resolution" />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-fg">How are you feeling today?</p>
            <p className="text-xs text-fg-subtle mt-0.5">Quick wellness check-in</p>
          </div>
          <div className="flex items-center gap-2">
            {MOODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => handleMoodPick(m)}
                title={m.label}
                className={cn(
                  'h-11 w-11 rounded-xl text-xl flex items-center justify-center transition-all hover:scale-110',
                  todayMood === m.key ? 'bg-primary/10 ring-2 ring-primary' : 'bg-muted/60 hover:bg-muted'
                )}
              >
                {m.emoji}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-fg-subtle">Today's Status</p>
            <p className="mt-2 text-lg font-semibold text-fg">{todayStatus.label || 'Not checked in'}</p>
            <p className="mt-1 text-xs text-fg-subtle">
              {todayStatus.checkInLabel && `In ${todayStatus.checkInLabel}`}
            </p>
          </div>
          <Button
            className="mt-4 w-full"
            icon={canCheckOut ? LogOut : LogIn}
            variant={canCheckOut ? 'danger' : 'primary'}
            onClick={handleCheckInOut}
            loading={checkIn.isPending || checkOut.isPending}
            disabled={!canCheckIn && !canCheckOut}
          >
            {canCheckOut ? 'Check Out' : canCheckIn ? 'Check In' : 'Day Complete'}
          </Button>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="My Attendance" subtitle="Last 7 days" />
          <div className="p-5 pt-3 grid grid-cols-7 gap-2">
            {last7.map((a) => {
              const tone = {
                present: 'bg-success/15 text-success',
                wfh: 'bg-primary/15 text-primary',
                late: 'bg-warning/15 text-warning',
                absent: 'bg-danger/15 text-danger',
                weekend: 'bg-muted text-fg-subtle',
                future: 'bg-muted/50 text-fg-subtle',
                none: 'bg-muted text-fg-subtle',
              }[a.state] || 'bg-muted text-fg-subtle';
              return (
                <div key={a.date} className={`rounded-lg py-2.5 text-center ${tone} ${a.isToday ? 'ring-2 ring-primary' : ''}`}>
                  <p className="text-[10px] font-medium">{a.dayLabel}</p>
                  <p className="text-xs font-semibold mt-1">{a.dateLabel}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Leave Balances" subtitle={String(api?.leaveBalances?.year || new Date().getFullYear())} action={<Link to="/leave/apply" className="text-xs font-medium text-primary hover:underline">Apply for leave</Link>} />
        <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {leaveItems.length === 0 ? (
            <p className="text-sm text-fg-subtle col-span-full">No leave balance data.</p>
          ) : leaveItems.map((b) => (
            <div key={b.code} className="rounded-xl bg-muted/50 p-4">
              <p className="text-sm font-medium text-fg">{leaveTypeLabel(b.code, b.label || b.name)}</p>
              <p className="mt-1 text-xl font-semibold text-fg tabular-nums">{b.available}<span className="text-xs font-normal text-fg-subtle"> / {b.total} days</span></p>
              <ProgressBar value={b.total ? (b.used / b.total) * 100 : 0} className="mt-2" size="sm" />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Latest Payslip" subtitle={latestPayslip?.period || ''} action={<Link to="/payroll/me" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 flex items-center gap-4">
            <div className="h-11 w-11 rounded-xl bg-success/10 text-success flex items-center justify-center shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold text-fg">{latestPayslip ? formatCurrency(latestPayslip.netPay) : '—'}</p>
              <p className="text-xs text-fg-subtle">{latestPayslip?.subtitle || 'No published payslip yet'}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="My Open Expense Claims" subtitle={`${openExpenses.length} claims`} action={<Link to="/expenses/me" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-2">
            {openExpenses.length === 0 ? (
              <p className="text-sm text-fg-subtle">No open claims.</p>
            ) : openExpenses.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <div className="h-9 w-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
                  <Receipt className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{e.title}</p>
                  <p className="text-xs text-fg-subtle">{e.category} · {formatCurrency(e.amount)}</p>
                </div>
                <StatusBadge status={e.status?.toLowerCase()} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <RecentAnnouncements />
    </div>
  );
}
