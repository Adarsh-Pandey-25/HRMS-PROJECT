import { Check, X, Home } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, StatusBadge, EmptyState, Skeleton } from '../../components/ui';
import { usePendingWfhRequests, useAttendanceMutations } from '../../hooks/useAttendance';
import { formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function WfhApprovals() {
  const { data: rows = [], isLoading } = usePendingWfhRequests();
  const { reviewWfh } = useAttendanceMutations();

  const act = async (id, status) => {
    try {
      await reviewWfh.mutateAsync({ id, status });
      toast.success(status === 'approved' ? 'WFH approved' : 'WFH rejected');
    } catch (err) {
      toast.error(err.message || 'Review failed');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="WFH Approvals"
        subtitle="Approve or reject employees’ work-from-home requests for today"
      />

      <Card>
        <CardHeader title="Pending requests" subtitle={`${rows.length} waiting`} />
        <div className="p-5 pt-3">
          {isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : rows.length === 0 ? (
            <EmptyState icon={Home} title="No pending WFH requests" message="When employees request WFH for today, they will appear here." />
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const emp = r.employee || {};
                const name = emp.first_name
                  ? `${emp.first_name} ${emp.last_name || ''}`.trim()
                  : emp.firstName
                    ? `${emp.firstName} ${emp.lastName || ''}`.trim()
                    : 'Employee';
                return (
                  <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
                    <Avatar name={name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-fg">{name}</p>
                      <p className="text-xs text-fg-subtle">
                        {formatDate(r.work_date || r.workDate)} · {emp.department || emp.designation || '—'}
                      </p>
                      {(r.reason) && <p className="text-xs text-fg-muted mt-0.5 truncate">{r.reason}</p>}
                    </div>
                    <StatusBadge status={r.status || 'pending'} />
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        icon={Check}
                        onClick={() => act(r.id, 'approved')}
                        loading={reviewWfh.isPending}
                        disabled={reviewWfh.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={X}
                        onClick={() => act(r.id, 'rejected')}
                        disabled={reviewWfh.isPending}
                      >
                        Reject
                      </Button>
                    </div>
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
