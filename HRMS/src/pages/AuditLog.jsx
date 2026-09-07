import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { PageHeader, Card, CardHeader, Select, Input, Skeleton, EmptyState, Badge } from '../components/ui';
import { listAuditLogsApi } from '../api/auditLog.api';
import { formatDateTime, humanize } from '../lib/utils';

const ACTION_TONE = {
  offboard: 'danger', erase: 'danger', reject: 'danger',
  approve: 'success', publish: 'success',
  update: 'info', self_edit: 'primary', upload: 'primary', assign: 'primary',
};

function actionTone(actionType) {
  const suffix = String(actionType || '').split('.').pop();
  return ACTION_TONE[suffix] || 'neutral';
}

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [actionType, setActionType] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = useMemo(() => ({
    page, limit: 25,
    ...(actionType && { action_type: actionType }),
    ...(targetType && { target_type: targetType }),
    ...(from && { from }),
    ...(to && { to }),
  }), [page, actionType, targetType, from, to]);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => listAuditLogsApi(params),
  });

  const rows = data?.items || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Audit Log" subtitle="Every sensitive action taken across this workspace." />

      <div className="flex flex-wrap gap-3">
        <Input placeholder="Action type (e.g. employee.offboard)" value={actionType} onChange={(e) => { setActionType(e.target.value); setPage(1); }} className="w-64" />
        <Input placeholder="Target type (e.g. employee)" value={targetType} onChange={(e) => { setTargetType(e.target.value); setPage(1); }} className="w-52" />
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
      </div>

      <Card>
        <CardHeader title="Log" subtitle={meta ? `${meta.total} total` : ''} />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : rows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No audit log entries" message="Nothing matches these filters." className="py-12" />
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['When', 'Actor', 'Action', 'Target', 'IP'].map((h) => (
                      <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-3 pr-3 text-fg-subtle text-xs whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                      <td className="py-3 pr-3 text-fg">
                        {r.actor ? `${r.actor.firstName || ''} ${r.actor.lastName || ''}`.trim() : 'System'}
                        <span className="ml-1.5 text-xs text-fg-subtle">({humanize(r.actorRole)})</span>
                      </td>
                      <td className="py-3 pr-3"><Badge tone={actionTone(r.actionType)}>{r.actionType}</Badge></td>
                      <td className="py-3 pr-3 text-fg-muted text-xs">{r.targetType}{r.targetId ? ` · ${String(r.targetId).slice(0, 8)}…` : ''}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-fg-subtle">{r.ipAddress || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {meta && meta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-xs text-fg-subtle">Page {meta.page} of {meta.totalPages} · {meta.total} records</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={meta.page <= 1} className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:bg-muted disabled:opacity-30">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))} disabled={meta.page >= meta.totalPages} className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:bg-muted disabled:opacity-30">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
