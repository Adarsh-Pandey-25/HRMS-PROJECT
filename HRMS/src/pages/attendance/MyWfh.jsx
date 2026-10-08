import { useNavigate } from 'react-router-dom';
import { Home, Plus, X } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, StatusBadge, EmptyState, Skeleton } from '../../components/ui';
import { useMyWfhRequests, useAttendanceMutations } from '../../hooks/useAttendance';
import { formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

/**
 * One row per WFH request. The API groups a multi-day request's per-day rows
 * into a single object carrying fromDate/toDate/totalDays, so a range shows as
 * one entry here rather than one per day.
 */
export default function MyWfh() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useMyWfhRequests();
  const { cancelWfh } = useAttendanceMutations();

  const cancel = async (id) => {
    try {
      await cancelWfh.mutateAsync(id);
      toast.success('WFH request cancelled');
    } catch (err) {
      toast.error(err.message || 'Failed to cancel request');
    }
  };

  const rangeLabel = (r) => {
    const from = r.fromDate || r.workDate;
    const to = r.toDate || r.workDate;
    if (!from) return '—';
    if (!to || to === from) return formatDate(from);
    return `${formatDate(from)} → ${formatDate(to)}`;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Work From Home"
        subtitle="Your WFH requests and their approval status"
        actions={
          <Button icon={Plus} onClick={() => navigate('/attendance/wfh/apply')}>
            Apply for WFH
          </Button>
        }
      />

      <Card>
        <CardHeader title="My requests" subtitle={`${rows.length} total`} />
        <div className="p-5 pt-3">
          {isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Home}
              title="No WFH requests yet"
              message="Apply for work from home and your Manager or HR will review it."
              action={
                <Button icon={Plus} onClick={() => navigate('/attendance/wfh/apply')}>
                  Apply for WFH
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const days = Number(r.totalDays || 1);
                return (
                  <div
                    key={r.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-fg">
                        {rangeLabel(r)}
                        {days > 1 && (
                          <span className="ml-2 text-xs font-normal text-fg-subtle">
                            {days} days
                          </span>
                        )}
                      </p>
                      {r.reason && <p className="text-xs text-fg-muted mt-0.5 truncate">{r.reason}</p>}
                      {r.reviewNote && (
                        <p className="text-xs text-fg-subtle mt-0.5 truncate">Note: {r.reviewNote}</p>
                      )}
                    </div>
                    <StatusBadge status={r.status || 'pending'} />
                    {r.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={X}
                        className="shrink-0"
                        onClick={() => cancel(r.id)}
                        disabled={cancelWfh.isPending}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
