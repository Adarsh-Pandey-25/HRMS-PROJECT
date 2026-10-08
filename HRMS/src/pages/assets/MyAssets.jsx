import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Laptop, Smartphone, Tablet, Armchair, Mouse, Package, Clock, XCircle } from 'lucide-react';
import { PageHeader, Card, Button, StatusBadge, EmptyState, Skeleton, Modal, Textarea, Badge } from '../../components/ui';
import { useMyAssets, useMyTickets, useAssetMutations } from '../../hooks/useModules';
import { formatDate } from '../../lib/utils';
import { isAssetReturnTicket, parseAssetReturnAssetId, returnDecision } from '../../lib/assetReturn';
import toast from 'react-hot-toast';

const CAT_ICON = {
  Laptop, Phone: Smartphone, Tablet, Monitor, Furniture: Armchair, Peripheral: Mouse,
};

export default function MyAssets() {
  const navigate = useNavigate();
  const { data: myAssets = [], isLoading } = useMyAssets();
  const { data: myTickets = [] } = useMyTickets();
  const { requestAssetReturn } = useAssetMutations();
  const [returnFor, setReturnFor] = useState(null);
  const [reason, setReason] = useState('');

  /**
   * Latest return request per asset. A return is a tagged helpdesk ticket
   * (see lib/assetReturn.js), so the decision the employee sees here is the
   * same record HR/Admin acted on — not a separate copy that can drift.
   */
  const returnByAsset = useMemo(() => {
    const map = new Map();
    for (const t of myTickets) {
      if (!isAssetReturnTicket(t)) continue;
      const assetId = parseAssetReturnAssetId(t);
      if (!assetId) continue;
      const prev = map.get(assetId);
      if (!prev || new Date(t.createdAt || 0) > new Date(prev.createdAt || 0)) map.set(assetId, t);
    }
    return map;
  }, [myTickets]);

  const submitReturn = async () => {
    if (!returnFor) return;
    try {
      await requestAssetReturn.mutateAsync({ id: returnFor.id, reason: reason.trim() || undefined });
      toast.success('Return request sent — waiting for HR/Admin approval');
      setReturnFor(null);
      setReason('');
    } catch (err) {
      toast.error(err.message || 'Could not send the return request');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My Assets" subtitle="Company equipment assigned to you" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <Skeleton className="h-32 md:col-span-2 rounded-card" />
        ) : myAssets.length === 0 ? (
          <Card className="py-6 md:col-span-2"><EmptyState icon={Monitor} title="No assets assigned" message="You don't have any company assets yet." /></Card>
        ) : myAssets.map((a) => {
          const Icon = CAT_ICON[a.category] || Package;
          const subject = encodeURIComponent(`Asset issue: ${a.name || a.serialNumber || a.id}`);
          const ticket = returnByAsset.get(a.id);
          const decision = returnDecision(ticket);
          const pending = decision === 'pending';

          return (
            <Card key={a.id} className="p-5">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="h-7 w-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-fg">{a.name}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">{a.brand} · {a.serialNumber}</p>
                  <p className="text-xs text-fg-subtle">Assigned {a.assignedOn ? formatDate(a.assignedOn) : '—'}</p>

                  {pending && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      Return requested — waiting for HR/Admin approval
                    </p>
                  )}
                  {decision === 'rejected' && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      Return request was rejected — the asset stays with you
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => { setReturnFor(a); setReason(''); }}
                    >
                      {pending ? 'Return requested' : decision === 'rejected' ? 'Request return again' : 'Return'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/helpdesk/new?subject=${subject}&category=assets`)}
                    >
                      Report Issue
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <StatusBadge status={a.status} dot={false} />
                  {pending && <Badge tone="warning">Return pending</Badge>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal
        open={Boolean(returnFor)}
        onClose={() => { if (!requestAssetReturn.isPending) { setReturnFor(null); setReason(''); } }}
        title={`Return ${returnFor?.name || 'asset'}?`}
        subtitle="HR or Admin reviews this. The asset stays assigned to you until they approve it."
        footer={(
          <>
            <Button variant="outline" onClick={() => setReturnFor(null)} disabled={requestAssetReturn.isPending}>
              Cancel
            </Button>
            <Button onClick={submitReturn} loading={requestAssetReturn.isPending} disabled={requestAssetReturn.isPending}>
              Send return request
            </Button>
          </>
        )}
      >
        <Textarea
          label="Reason (optional)"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Switching to a new laptop, no longer needed…"
        />
      </Modal>
    </div>
  );
}
