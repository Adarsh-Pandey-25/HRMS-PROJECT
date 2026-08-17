import { useState, useMemo } from 'react';
import { Check, X, Plus } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, StatusBadge, Badge, Modal, Select, Textarea, EmptyState, Skeleton } from '../../components/ui';
import { useAssetRequests, useAssetCategories, useAssetMutations } from '../../hooks/useModules';
import { useAuthStore } from '../../store/authStore';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { resolveCategoryOptions } from '../../api/assets.api';
import { humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function AssetRequests() {
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const isApprover = ['admin', 'hr'].includes(role);
  const { data: requests = [], isLoading } = useAssetRequests();
  const { data: categories = [] } = useAssetCategories();
  const { submitRequest, updateRequest } = useAssetMutations();
  const employeeMap = useEmployeeMap();
  const categoryOptions = useMemo(() => resolveCategoryOptions(categories), [categories]);

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ assetType: '', urgency: 'medium', reason: '' });

  const visible = isApprover ? requests : requests.filter((r) => r.employeeId === user?.id);
  const pendingCount = visible.filter((r) => ['requested', 'pending'].includes(String(r.status).toLowerCase())).length;

  const act = async (id, status) => {
    try {
      await updateRequest.mutateAsync({ id, status });
      toast.success(`Request ${status}`);
    } catch (err) {
      toast.error(err.message || 'Action failed');
    }
  };

  const submit = async () => {
    if (!form.assetType.trim() || !form.reason.trim()) return toast.error('Please fill asset type and reason');
    try {
      await submitRequest.mutateAsync(form);
      toast.success('Asset request submitted');
      setModal(false);
      setForm({ assetType: '', urgency: 'medium', reason: '' });
    } catch (err) {
      toast.error(err.message || 'Failed to submit request');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Asset Requests"
        subtitle={isApprover ? 'Employee requests for new or replacement equipment' : 'Your requests for new or replacement equipment'}
        actions={!isApprover && <Button icon={Plus} onClick={() => setModal(true)}>Raise Request</Button>}
      />

      {isApprover && pendingCount > 0 && (
        <Card className="p-4 border-warning/30 bg-warning/5">
          <p className="text-sm text-fg"><strong>{pendingCount}</strong> request{pendingCount === 1 ? '' : 's'} awaiting approval</p>
        </Card>
      )}

      <Card>
        <CardHeader title="Asset Requests" subtitle={`${visible.length} total`} />
        <div className="p-5 pt-3">
          {isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : visible.length === 0 ? (
            <EmptyState icon={Plus} title="No requests" message="No asset requests to show yet." />
          ) : (
            <div className="space-y-2">
              {visible.map((r) => {
                const e = employeeMap[r.employeeId];
                const name = e?.name || 'Employee';
                return (
                  <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Avatar name={name} size="md" />
                      <div>
                        <p className="text-sm font-medium text-fg">{name} · {r.assetType}</p>
                        <p className="text-xs text-fg-subtle">{r.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.urgency === 'high' ? 'danger' : r.urgency === 'medium' ? 'warning' : 'neutral'}>{humanize(r.urgency)}</Badge>
                      {isApprover && (r.status === 'requested' || r.status === 'pending') ? (
                        <>
                          <Button variant="danger-ghost" size="sm" icon={X} onClick={() => act(r.id, 'rejected')} aria-label="Reject" />
                          <Button size="sm" icon={Check} onClick={() => act(r.id, 'approved')}>Approve</Button>
                        </>
                      ) : (
                        <StatusBadge status={r.status} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Raise Asset Request"
        footer={<><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button onClick={submit} disabled={submitRequest.isPending}>Submit Request</Button></>}
      >
        <div className="space-y-4">
          <Select label="Asset type" placeholder="Select asset type" options={categoryOptions} value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} />
          <Select label="Urgency" options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} />
          <Textarea label="Reason" rows={3} placeholder="Explain why you need this asset..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
