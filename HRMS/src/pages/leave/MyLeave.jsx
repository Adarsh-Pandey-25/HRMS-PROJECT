import { Link } from 'react-router-dom';
import { CalendarDays, Palmtree } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, CardHeader, Button, StatusBadge, EmptyState, ProgressBar, Skeleton } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import { useMyLeaves, useLeaveBalance, useLeaveTypes, useLeaveMutations } from '../../hooks/useLeaves';
import { useUpcomingHolidays } from '../../hooks/useAnnouncements';
import { leaveTypeLabel } from '../../lib/mappers';
import { formatDate, cn } from '../../lib/utils';

function toneForRemaining(remaining, total) {
  if (!total) return 'info';
  const pct = (remaining / total) * 100;
  if (pct <= 20) return 'danger';
  if (pct <= 40) return 'warning';
  return 'primary';
}

const TONE_CLASS = {
  primary: 'text-primary',
  danger: 'text-danger',
  info: 'text-info',
  warning: 'text-warning',
  teal: 'text-teal',
};

export default function MyLeave() {
  const user = useAuthStore((s) => s.user);
  const { data: leaves = [], isLoading: leavesLoading } = useMyLeaves();
  const { data: balance, isLoading: balanceLoading } = useLeaveBalance(user?.id);
  const { data: leaveTypes } = useLeaveTypes();
  const { data: holidays = [] } = useUpcomingHolidays();
  const { cancel } = useLeaveMutations();

  const nameByCode = {};
  const rows = Array.isArray(leaveTypes) ? leaveTypes : leaveTypes?.types || [];
  for (const t of rows) {
    const code = String(t.code || t.leave_type || t.leaveType || '').toUpperCase();
    if (code) nameByCode[code] = t.name || leaveTypeLabel(code);
  }

  const balanceItems = balance?.items?.length
    ? balance.items
    : Object.values(balance?.balances || {}).filter(
      (b, i, arr) => b?.code && arr.findIndex((x) => x.code === b.code) === i
    );

  const cards = balanceItems.map((b) => ({
    ...b,
    name: nameByCode[b.code] || b.name || leaveTypeLabel(b.code),
    tone: toneForRemaining(b.remaining, b.total),
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Leave"
        subtitle="Your balances and leave history"
        actions={<Link to="/leave/apply"><Button>Apply Leave</Button></Link>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {balanceLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-card" />)
        ) : cards.length === 0 ? (
          <Card className="p-5 col-span-full"><p className="text-sm text-fg-subtle">No leave balance data yet. Ask Admin to Save &amp; Apply leave policy.</p></Card>
        ) : cards.map((b) => {
          const pct = b.total ? (b.remaining / b.total) * 100 : 0;
          return (
            <Card key={b.code} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-fg-muted truncate" title={b.name}>{b.name}</p>
                <span className={cn('text-xs font-semibold shrink-0', TONE_CLASS[b.tone])}>{b.remaining} left</span>
              </div>
              <p className="text-3xl font-semibold text-fg mt-2 tabular-nums">
                {b.remaining}<span className="text-base text-fg-subtle">/{b.total}</span>
              </p>
              <ProgressBar value={pct} tone={b.tone} className="mt-3" size="sm" />
              <p className="text-xs text-fg-subtle mt-2">{b.used} days used · {b.code}</p>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Leave History" subtitle={`${leaves.length} requests`} />
          <div className="p-5 pt-3">
            {leavesLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : leaves.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No leave yet" message="Apply for leave to see it here." />
            ) : (
              <div className="space-y-2">
                {leaves.map((l) => (
                  <div key={l.id} className="flex items-center gap-4 rounded-xl border border-border/60 p-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 font-semibold text-xs">
                      {(l.leaveType || l.type || 'LV').slice(0, 3)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">
                        {leaveTypeLabel(l.leaveType || l.type, l.label)} · {formatDate(l.from)} – {formatDate(l.to)} · {l.days}d
                      </p>
                      <p className="text-xs text-fg-subtle truncate">{l.reason}</p>
                    </div>
                    <StatusBadge status={l.status} />
                    {l.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cancel.isPending}
                        onClick={async () => {
                          try {
                            await cancel.mutateAsync(l.id);
                            toast.success('Leave request cancelled');
                          } catch (err) {
                            toast.error(err.message || 'Cancel failed');
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Upcoming Holidays" action={<Link to="/leave/holidays" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
          <div className="p-5 pt-3 space-y-3">
            {holidays.slice(0, 6).map((h) => (
              <div key={h.id || h.name} className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-teal/10 text-teal flex items-center justify-center shrink-0">
                  <Palmtree className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{h.name}</p>
                  <p className="text-xs text-fg-subtle capitalize">{h.type}</p>
                </div>
                <span className="text-xs text-fg-subtle whitespace-nowrap">{formatDate(h.date, 'dd MMM')}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
