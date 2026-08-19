import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, UserPlus, CalendarOff, Briefcase, UserCheck, Home, Clock, UserX, Video,
} from 'lucide-react';
import { Card, CardHeader, StatCard, Avatar, StatusBadge, Skeleton } from '../../components/ui';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useEmployees } from '../../hooks/useEmployees';
import { formatDate, cn } from '../../lib/utils';
import { employeeProfilePath } from '../../lib/employeeRoutes';
import { Greeting, RecentAnnouncements } from './shared';

const ATTENDANCE_STATS = [
  { key: 'present', label: 'Present', icon: UserCheck, tone: 'text-success bg-success/10' },
  { key: 'wfh', label: 'WFH', icon: Home, tone: 'text-primary bg-primary/10' },
  { key: 'late', label: 'Late', icon: Clock, tone: 'text-warning bg-warning/10' },
  { key: 'absent', label: 'Absent', icon: UserX, tone: 'text-danger bg-danger/10' },
];

export default function HRDashboard({ user }) {
  const { data: api, isLoading } = useDashboardData();
  const { employees, isFetched: staffLoaded } = useEmployees();
  const kpis = api?.kpis || {};
  const staffCount = useMemo(() => {
    const fromDirectory = (employees || []).filter((e) => {
      const role = String(e.role || '').toLowerCase().trim();
      return role !== 'admin' && role !== 'super_admin';
    }).length;
    return staffLoaded ? fromDirectory : Number(kpis.totalEmployees || 0);
  }, [employees, staffLoaded, kpis.totalEmployees]);
  const attendance = api?.attendanceSummary || {};
  const pendingLeaves = api?.pendingLeaveApprovals?.items || [];
  const pendingExpenses = api?.pendingExpenseClaims?.items || [];
  const recentHires = api?.recentHires?.items || [];
  const interviews = api?.upcomingInterviews?.items || [];

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
        <StatCard label="Total Employees" value={staffCount} icon={Users} tone="primary" delta={kpis.employeeTrendPercent} deltaLabel="vs last month" to="/employees" />
        <StatCard label="New This Month" value={kpis.newThisMonth} icon={UserPlus} tone="teal" delta={kpis.newHiresTrendPercent} deltaLabel="vs last month" to="/employees?hired=this-month" />
        <StatCard label="On Leave Today" value={kpis.onLeaveToday} icon={CalendarOff} tone="warning" footer="Across all teams" to="/leave/team" />
        <StatCard label="Open Job Positions" value={kpis.openPositions} icon={Briefcase} tone="info" footer="Recruitment module" to="/recruitment/jobs" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Attendance Summary" subtitle={attendance.subtitle || `${attendance.teamSize || 0} team members`} />
          <div className="p-5 pt-3 grid grid-cols-2 gap-3">
            {ATTENDANCE_STATS.map((s) => (
              <div key={s.key} className="rounded-xl bg-muted/50 p-3">
                <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center mb-2', s.tone)}>
                  <s.icon className="h-4 w-4" />
                </div>
                <p className="text-xl font-semibold text-fg tabular-nums">{attendance[s.key] ?? 0}</p>
                <p className="text-xs text-fg-subtle">{s.label}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Upcoming Interviews" subtitle="From Recruitment" />
          <div className="p-5 pt-3 space-y-2.5">
            {interviews.length === 0 ? (
              <p className="text-sm text-fg-subtle">No interviews scheduled.</p>
            ) : interviews.slice(0, 4).map((i) => (
              <Link key={i.id} to="/recruitment/interviews" className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Video className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{i.candidateName}</p>
                  <p className="text-xs text-fg-subtle truncate">{i.role} · with {i.interviewer}</p>
                </div>
                <span className="text-xs text-fg-subtle whitespace-nowrap">{i.scheduledAt}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Pending Leave Approvals" subtitle={`${api?.pendingLeaveApprovals?.count ?? pendingLeaves.length} awaiting action`} action={<Link to="/leave/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-2">
            {pendingLeaves.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nothing pending.</p>
            ) : pendingLeaves.slice(0, 5).map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <Avatar name={`${l.firstName} ${l.lastName}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{l.firstName} {l.lastName}</p>
                  <p className="text-xs text-fg-subtle">{l.leaveType} · {l.totalDays}d · {l.fromDate}</p>
                </div>
                <StatusBadge status="pending" />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Pending Expense Claims" subtitle={`${api?.pendingExpenseClaims?.count ?? pendingExpenses.length} awaiting action`} action={<Link to="/expenses/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-2">
            {pendingExpenses.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nothing pending.</p>
            ) : pendingExpenses.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{e.firstName} {e.lastName}</p>
                  <p className="text-xs text-fg-subtle truncate">{e.category} · {e.description}</p>
                </div>
                <StatusBadge status="pending" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent Hires" subtitle="Joined in the last month" />
        <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {recentHires.length === 0 ? (
            <p className="text-sm text-fg-subtle">No new hires in the last month.</p>
          ) : recentHires.map((e) => (
            <Link key={e.id} to={employeeProfilePath(e)} className="flex items-center gap-3 rounded-xl border border-border/60 p-3 hover:bg-muted/40 transition-colors">
              <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg truncate">{e.firstName} {e.lastName}</p>
                <p className="text-xs text-fg-subtle truncate">{e.label || e.designation}</p>
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <RecentAnnouncements />
    </div>
  );
}
