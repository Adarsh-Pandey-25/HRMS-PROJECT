import { useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, CalendarOff, Briefcase, UserCheck, Home, Clock,
  UserX, Cake, Award, Video, Receipt, FileClock, TrendingUp, TrendingDown,
} from 'lucide-react';
import { Card, CardHeader, StatCard, Avatar, Skeleton } from '../../components/ui';
import { ChartSkeleton } from '../../components/charts/ChartSkeleton';
import { ErrorBoundary } from '../../components/layout/ErrorBoundary';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useEmployees } from '../../hooks/useEmployees';
import { employeeProfilePath } from '../../lib/employeeRoutes';

const EMPTY_KPI = { totalEmployees: 0, onLeaveToday: 0, openPositions: 0, newHires: 0 };
const EMPTY_ATTENDANCE = { present: 0, wfh: 0, late: 0, absent: 0 };

import HeadcountDrilldownChart from '../../components/charts/HeadcountDrilldownChart';
const DepartmentPie3D = lazy(() => import('../../components/charts/DepartmentPie3D'));
import { formatDate, formatCompactINR, timeAgo, cn } from '../../lib/utils';
import { Greeting, RecentAnnouncements, PendingList } from './shared';

const ATTENDANCE_STATS = [
  { key: 'present', label: 'Present', icon: UserCheck, tone: 'text-success bg-success/10' },
  { key: 'wfh', label: 'WFH', icon: Home, tone: 'text-primary bg-primary/10' },
  { key: 'late', label: 'Late', icon: Clock, tone: 'text-warning bg-warning/10' },
  { key: 'absent', label: 'Absent', icon: UserX, tone: 'text-danger bg-danger/10' },
];

const EVENT_ICON = { birthday: Cake, anniversary: Award, interview: Video };
const ACTIVITY_TONE = {
  join: 'bg-success/10 text-success',
  hire: 'bg-success/10 text-success',
  leave: 'bg-info/10 text-info',
  expense: 'bg-warning/10 text-warning',
  review: 'bg-teal/10 text-teal',
  asset: 'bg-primary/10 text-primary',
  ticket: 'bg-pink-500/10 text-pink-500',
};

export default function AdminDashboard({ user }) {
  const { data: api, isLoading, isError } = useDashboardData();
  const { employees, isFetched: staffLoaded } = useEmployees();

  const kpis = api?.kpis || EMPTY_KPI;
  const staffEmployees = useMemo(() => (
    (employees || []).filter((e) => {
      const role = String(e.role || '').toLowerCase().trim();
      return role !== 'admin' && role !== 'super_admin';
    })
  ), [employees]);

  const staffCount = staffLoaded ? staffEmployees.length : Number(kpis.totalEmployees || 0);

  const donutData = useMemo(() => {
    if (staffLoaded) {
      const counts = {};
      staffEmployees.forEach((e) => {
        const dept = (e.department || 'Unassigned').trim() || 'Unassigned';
        counts[dept] = (counts[dept] || 0) + 1;
      });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }));
    }
    return (api?.byDepartment || []).map((d) => ({ name: d.department, value: d.count }));
  }, [staffLoaded, staffEmployees, api?.byDepartment]);
  const attendance = api?.attendanceToday || EMPTY_ATTENDANCE;
  const pending = api?.pendingApprovals || { leaves: 0, expenses: 0, tickets: 0 };

  const payroll = api?.payrollCost;
  const thisMonthCost = payroll ? { cost: payroll.current } : { cost: 0 };
  const lastMonthCost = payroll ? { cost: payroll.previous } : { cost: 0 };
  const costDelta = payroll?.changePercent ?? 0;

  const newHires = useMemo(() => {
    if (api?.newHires?.items?.length) {
      return api.newHires.items.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        designation: e.designation,
        department: e.department,
        joinDate: e.joinedAt,
      }));
    }
    return [];
  }, [api?.newHires]);

  const upcoming = api?.upcomingEvents || [];
  const activity = api?.activityFeed || [];

  const upcomingEvents = (api?.upcoming || upcoming).map((e) => ({
    type: e.type,
    name: e.title || e.name,
    label: e.subtitle || e.label,
    date: e.date || e.sortDate,
  }));

  const activityFeed = (api?.recentActivity || activity).map((a) => ({
    id: a.id,
    type: a.type,
    actor: a.name || a.actor || a.initials || '?',
    initials: a.initials || a.actor || '?',
    text: a.message || a.text,
    at: a.sortAt || a.at,
    relativeTime: a.relativeTime || null,
  }));

  const pendingItems = [
    { label: 'Leave requests', count: pending.leaves ?? pending.leave, icon: FileClock, to: '/leave/approvals', tone: 'text-info bg-info/10' },
    { label: 'Expense claims', count: pending.expenses ?? pending.expense, icon: Receipt, to: '/expenses/approvals', tone: 'text-warning bg-warning/10' },
  ];

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
      {isError && (
        <p className="text-xs text-warning bg-warning/10 rounded-lg px-3 py-2">
          Live dashboard unavailable. Showing empty values until the API responds.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Employees" value={staffCount} icon={Users} tone="primary" delta={kpis.employeeTrendPercent ?? kpis.totalDelta} deltaLabel="vs last month" to="/employees" />
        <StatCard label="Present Today" value={attendance.present ?? kpis.presentToday} icon={UserCheck} tone="success" footer={`of ${attendance.teamSize ?? attendance.total ?? staffCount} team members`} to="/attendance/team" />
        <StatCard label="On Leave Today" value={kpis.onLeaveToday} icon={CalendarOff} tone="warning" footer="Across all teams" to="/leave/team" />
        <StatCard label="Open Positions" value={kpis.openPositions} icon={Briefcase} tone="info" footer={kpis.openPositionsPlaceholder ? 'Recruitment module' : 'Actively hiring'} to="/recruitment/jobs" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Headcount Trend" subtitle="Last 12 months" />
          <div className="px-4 pb-5 pt-2">
            <ErrorBoundary variant="inline" label="Chart unavailable">
              <HeadcountDrilldownChart />
            </ErrorBoundary>
          </div>
        </Card>

        <Card>
          <CardHeader title="By Department" subtitle="Hover a slice for details" />
          <div className="px-4 pb-5 pt-3">
            <ErrorBoundary variant="inline" label="Chart unavailable">
              <Suspense fallback={<ChartSkeleton height={340} />}>
                <DepartmentPie3D data={donutData} />
              </Suspense>
            </ErrorBoundary>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <p className="text-xs font-medium text-fg-subtle">Payroll Cost This Month</p>
          <p className="mt-2 text-kpi text-fg tabular-nums">{formatCompactINR(thisMonthCost.cost)}</p>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className={cn('inline-flex items-center gap-0.5 font-medium', costDelta >= 0 ? 'text-danger' : 'text-success')}>
              {costDelta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(Number(costDelta)).toFixed(1)}%
            </span>
            <span className="text-fg-subtle">vs {formatCompactINR(lastMonthCost.cost)} last month</span>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="New Hires This Month" subtitle={`${newHires.length} joined`} />
          <div className="p-5 pt-3 space-y-2">
            {newHires.length === 0 ? (
              <p className="text-sm text-fg-subtle">No new hires yet this month.</p>
            ) : newHires.slice(0, 4).map((e) => (
              <Link key={e.id} to={employeeProfilePath(e)} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors">
                <Avatar name={e.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{e.name}</p>
                  <p className="text-xs text-fg-subtle truncate">{e.designation} · {e.department}</p>
                </div>
                <span className="text-xs text-fg-subtle whitespace-nowrap">{formatDate(e.joinDate, 'dd MMM')}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <RecentAnnouncements />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Attendance Today" subtitle={`${attendance.teamSize ?? attendance.total ?? staffCount} team members`} />
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

        <PendingList title="Pending Approvals" subtitle="Needs attention" items={pendingItems} />

        <Card>
          <CardHeader title="Upcoming" subtitle="Next few days" />
          <div className="p-5 pt-3 space-y-3">
            {upcomingEvents.slice(0, 5).map((e, i) => {
              const Icon = EVENT_ICON[e.type] || Video;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg truncate">{e.name}</p>
                    <p className="text-xs text-fg-subtle truncate">{e.label}</p>
                  </div>
                  <span className="text-[11px] text-fg-subtle">{formatDate(e.date, 'dd MMM')}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent Activity" subtitle="Latest across the organisation" />
        <div className="p-5 pt-3">
          <ol className="relative border-l border-border ml-2 space-y-5">
            {activityFeed.map((a) => (
              <li key={a.id} className="ml-5">
                <span className={cn('absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-card', ACTIVITY_TONE[a.type] || 'bg-primary/10')}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <Avatar name={a.actor} size="xs" />
                  <p className="text-sm text-fg">
                    <span className="font-medium">{a.actor}</span>{' '}
                    <span className="text-fg-muted">{a.text}</span>
                  </p>
                  <span className="text-xs text-fg-subtle ml-auto">
                    {a.relativeTime || timeAgo(a.at)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    </div>
  );
}
