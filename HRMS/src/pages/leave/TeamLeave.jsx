import { useMemo } from 'react';
import { CalendarOff, Users } from 'lucide-react';
import { PageHeader, Card, CardHeader, Avatar, StatusBadge, EmptyState, Badge } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { useTeamLeaves, useAllLeaves } from '../../hooks/useLeaves';
import { formatDate } from '../../lib/utils';

const today = () => new Date().toISOString().slice(0, 10);

export default function TeamLeave() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const teamQuery = useTeamLeaves({ enabled: !isHrAdmin });
  const allQuery = useAllLeaves({ enabled: isHrAdmin, status: 'approved' });
  const leaveRequests = isHrAdmin ? (allQuery.data || []) : (teamQuery.data || []);

  const onLeaveToday = useMemo(
    () => leaveRequests.filter((r) => r.status === 'approved' && r.from <= today() && r.to >= today()),
    [leaveRequests]
  );
  const upcoming = useMemo(
    () => leaveRequests.filter((r) => r.status === 'approved' && r.from > today()).sort((a, b) => a.from.localeCompare(b.from)),
    [leaveRequests]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Team Leaves" subtitle={role === 'manager' ? 'Your direct reports' : 'Across the organisation'} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="On Leave Today" subtitle={formatDate(today())} />
          <div className="p-5 pt-3">
            {onLeaveToday.length === 0 ? (
              <EmptyState icon={Users} title="Everyone's in" message="No one on the team is on leave today." />
            ) : (
              <div className="space-y-2">
                {onLeaveToday.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <Avatar name={l.employeeName || 'Employee'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg truncate">{l.employeeName}</p>
                      <p className="text-xs text-fg-subtle capitalize">{l.type} leave · back {formatDate(l.to, 'dd MMM')}</p>
                    </div>
                    <Badge tone="info">{l.days}d</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Upcoming Leave" subtitle="Next scheduled leave" />
          <div className="p-5 pt-3">
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarOff} title="Nothing scheduled" message="No upcoming approved leave for the team." />
            ) : (
              <div className="space-y-2">
                {upcoming.slice(0, 8).map((l) => (
                  <div key={l.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <Avatar name={l.employeeName || 'Employee'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg truncate">{l.employeeName}</p>
                      <p className="text-xs text-fg-subtle capitalize">{l.type} · {formatDate(l.from, 'dd MMM')}–{formatDate(l.to, 'dd MMM')}</p>
                    </div>
                    <StatusBadge status={l.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
