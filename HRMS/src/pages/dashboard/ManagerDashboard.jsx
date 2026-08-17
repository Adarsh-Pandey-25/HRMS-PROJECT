import { Link } from 'react-router-dom';
import { Users, UserCheck, CalendarOff, FileClock, Home, Clock, UserX, TrendingUp } from 'lucide-react';
import { Card, CardHeader, StatCard, Avatar, StatusBadge, Badge, ProgressBar, Skeleton } from '../../components/ui';
import { useDashboardData } from '../../hooks/useDashboardData';
import { formatDate, cn } from '../../lib/utils';
import { employeeProfilePath } from '../../lib/employeeRoutes';
import { Greeting, RecentAnnouncements, TeamMoodCard } from './shared';

const ATTENDANCE_STATS = [
  { key: 'present', label: 'Present', icon: UserCheck, tone: 'text-success bg-success/10' },
  { key: 'wfh', label: 'WFH', icon: Home, tone: 'text-primary bg-primary/10' },
  { key: 'late', label: 'Late', icon: Clock, tone: 'text-warning bg-warning/10' },
  { key: 'absent', label: 'Absent', icon: UserX, tone: 'text-danger bg-danger/10' },
];

export default function ManagerDashboard({ user }) {
  const { data: api, isLoading } = useDashboardData();
  const kpis = api?.kpis || {};
  const teamAttendance = api?.teamAttendance || {};
  const teamLeave = api?.pendingLeaveApprovals?.items || [];
  const teamExpenses = api?.pendingExpenseApprovals?.items || [];
  const teamPerf = api?.teamPerformance?.items || [];
  const team = api?.myTeam?.items || [];
  const moodItems = api?.teamMood?.items || [];

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
        <StatCard label="My Team Size" value={kpis.teamSize} icon={Users} tone="primary" footer="Direct reports" />
        <StatCard label="Present Today" value={kpis.presentToday} icon={UserCheck} tone="success" footer={`of ${kpis.teamSize} team members`} />
        <StatCard label="On Leave" value={kpis.onLeaveToday} icon={CalendarOff} tone="warning" footer="Today" />
        <StatCard label="Pending Approvals" value={kpis.pendingApprovals} icon={FileClock} tone="info" footer="Leave + expenses" />
      </div>

      <Card>
        <CardHeader title="Team Attendance" subtitle="Today" />
        <div className="p-5 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ATTENDANCE_STATS.map((s) => (
            <div key={s.key} className="rounded-xl bg-muted/50 p-3">
              <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center mb-2', s.tone)}>
                <s.icon className="h-4 w-4" />
              </div>
              <p className="text-xl font-semibold text-fg tabular-nums">{teamAttendance[s.key] ?? 0}</p>
              <p className="text-xs text-fg-subtle">{s.label}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Pending Leave Approvals" subtitle={`${api?.pendingLeaveApprovals?.count ?? teamLeave.length} from your team`} action={<Link to="/leave/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-2">
            {teamLeave.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nothing pending.</p>
            ) : teamLeave.map((l) => (
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
          <CardHeader title="Pending Expense Approvals" subtitle={`${api?.pendingExpenseApprovals?.count ?? teamExpenses.length} from your team`} action={<Link to="/expenses/approvals" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-2">
            {teamExpenses.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nothing pending.</p>
            ) : teamExpenses.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{e.firstName} {e.lastName}</p>
                  <p className="text-xs text-fg-subtle truncate">{e.label || e.description}</p>
                </div>
                <StatusBadge status="pending" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Team Performance Snapshot" subtitle="Current review cycle" action={<Link to="/performance/team" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-3">
            {teamPerf.length === 0 ? (
              <p className="text-sm text-fg-subtle">No review data for your team yet.</p>
            ) : teamPerf.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <Avatar name={`${r.firstName} ${r.lastName}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-fg truncate">{r.firstName} {r.lastName}</p>
                    <StatusBadge status={r.status?.toLowerCase()} />
                  </div>
                  <ProgressBar value={r.progress ?? 0} className="mt-1.5" />
                </div>
                <span className="flex items-center gap-1 text-xs font-medium text-fg-subtle shrink-0">
                  <TrendingUp className="h-3 w-3" /> {r.score}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="My Team" subtitle={`${team.length} direct reports`} action={<Link to="/employees" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-2">
            {team.length === 0 ? (
              <p className="text-sm text-fg-subtle">No direct reports.</p>
            ) : team.map((e) => (
              <Link key={e.id} to={employeeProfilePath(e)} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <Avatar name={`${e.firstName} ${e.lastName}`} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{e.firstName} {e.lastName}</p>
                  <p className="text-xs text-fg-subtle truncate">{e.designation}</p>
                </div>
                <Badge tone="neutral">{e.department}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <TeamMoodCard checkins={moodItems.map((m) => ({ mood: m.mood, emoji: m.emoji, count: m.count }))} title="Team Mood" subtitle={`${api?.teamMood?.totalCheckIns ?? 0} check-ins today`} />
      <RecentAnnouncements />
    </div>
  );
}
