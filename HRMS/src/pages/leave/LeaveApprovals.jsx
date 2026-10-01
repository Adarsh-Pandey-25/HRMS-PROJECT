import { useMemo } from 'react';
import { Check, X } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, EmptyState, Skeleton, Badge } from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { useTeamLeaves, useAllLeaves, useLeaveMutations } from '../../hooks/useLeaves';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { formatDate } from '../../lib/utils';
import { awaitingStage, normalizeFlow } from '../../lib/approvalFlow';
import toast from 'react-hot-toast';

export default function LeaveApprovals() {
  const role = useAuthStore((s) => s.role);
  const isHrOrAdmin = role === 'hr' || role === 'admin';
  const approvalLevel = useSettingsStore((s) => s.leavePolicy?.approvalLevel || 'single');
  const flow = normalizeFlow(approvalLevel, 'manager-only');
  const managerExcluded = !isHrOrAdmin && flow === 'hr-only';

  // HR/Admin need company-wide pending leaves — not just their direct reports
  const teamQuery = useTeamLeaves({ enabled: !isHrOrAdmin, status: 'pending' });
  const allQuery = useAllLeaves({ enabled: isHrOrAdmin, status: 'pending' });
  const requests = isHrOrAdmin ? (allQuery.data || []) : (teamQuery.data || []);
  const isLoading = isHrOrAdmin ? allQuery.isLoading : teamQuery.isLoading;

  const { approve, reject } = useLeaveMutations();

  // Each request sits in the queue of whoever's turn it is under the
  // company's approval flow (Settings → Leave Policy).
  const pending = useMemo(() => {
    const mine = isHrOrAdmin ? 'hr' : 'manager';
    return requests.filter((r) => r.status === 'pending'
      && awaitingStage(flow, { hasManager: Boolean(r.managerId), managerApproved: Boolean(r.managerApprovedBy) }) === mine);
  }, [requests, isHrOrAdmin, flow]);

  const exportRows = useMemo(
    () => pending.map((l) => ({
      employee: l.employeeName || l.employeeId,
      type: l.label || l.type,
      from: l.from,
      to: l.to,
      days: l.days,
      reason: l.reason,
      status: l.status,
    })),
    [pending]
  );

  const act = async (id, action) => {
    try {
      if (action === 'approved') await approve.mutateAsync(id);
      else await reject.mutateAsync({ id, reason: 'Rejected by approver' });
      toast.success(`Leave ${action}`);
    } catch (err) {
      toast.error(err.message || 'Action failed');
    }
  };

  const subtitle = isHrOrAdmin
    ? {
      'hr-only': 'Every leave request — HR approves all leave',
      'manager-then-hr': 'Leaves waiting for HR final approval (after manager)',
      'manager-only': 'Leave requests from employees without a manager — managers approve the rest',
    }[flow]
    : (managerExcluded ? 'HR approves leave requests in your company' : 'Team leave requests awaiting your approval');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Approvals" subtitle={subtitle} />

      <Card>
        <CardHeader
          title="Pending Approvals"
          subtitle={`${pending.length} awaiting action`}
          action={(
            <ExportButton
              rows={exportRows}
              filename="leave-approvals"
              title="Pending Leave Approvals"
              columns={['employee', 'type', 'from', 'to', 'days', 'reason', 'status']}
            />
          )}
        />
        <div className="p-5 pt-3">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : pending.length === 0 ? (
            <EmptyState
              icon={Check}
              title="All clear"
              message={managerExcluded ? "Your company has leave approved by HR only, so there's nothing for you to approve here." : 'No pending leave requests.'}
            />
          ) : (
            <div className="space-y-3">
              {pending.map((l) => (
                <div key={l.id} className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-border/60 p-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar name={l.employeeName || 'Employee'} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-fg">{l.employeeName || 'Employee'}</p>
                        {isHrOrAdmin && l.managerApprovedBy ? (
                          <Badge tone="info">Manager approved</Badge>
                        ) : null}
                        {isHrOrAdmin && !l.managerId ? (
                          <Badge tone="neutral">No manager</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-fg-subtle capitalize">{l.type} · {l.days}d · {formatDate(l.from, 'dd MMM')}–{formatDate(l.to, 'dd MMM')}</p>
                      <p className="text-xs text-fg-muted mt-0.5 truncate">{l.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="danger-ghost" size="sm" icon={X} onClick={() => act(l.id, 'rejected')} disabled={reject.isPending}>Reject</Button>
                    <Button size="sm" icon={Check} onClick={() => act(l.id, 'approved')} disabled={approve.isPending}>Approve</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
