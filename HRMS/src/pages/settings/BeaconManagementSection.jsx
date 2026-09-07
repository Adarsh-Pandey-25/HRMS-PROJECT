import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radio, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Badge, Modal, EmptyState, Skeleton } from '../../components/ui';
import { formatDateTime } from '../../lib/utils';
import {
  listBeaconsApi, createBeaconApi, revokeBeaconApi, listPendingBeaconApprovalsApi, resolveBeaconApprovalApi,
} from '../../api/ipBeacon.api';

const HEALTH_TONE = { healthy: 'success', stale: 'warning', never_pinged: 'neutral', revoked: 'neutral' };

/**
 * Section D: multi-branch IP beacon management. The ping endpoint itself
 * (what a MacroDroid-style push app calls) is intentionally NOT part of
 * this UI — see the backend report for its exact request shape.
 */
export function BeaconManagementSection() {
  const qc = useQueryClient();
  const { data: beacons = [], isLoading } = useQuery({ queryKey: ['attendance', 'beacons'], queryFn: listBeaconsApi });
  const { data: pending = [] } = useQuery({ queryKey: ['attendance', 'beacons', 'pending'], queryFn: listPendingBeaconApprovalsApi, refetchInterval: 30_000 });

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [expectedRegion, setExpectedRegion] = useState('');
  const [busy, setBusy] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState(null); // { beaconKey, beaconSecret, label }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['attendance', 'beacons'] });
    qc.invalidateQueries({ queryKey: ['attendance', 'beacons', 'pending'] });
  };

  const submitCreate = async () => {
    if (!label.trim()) { toast.error('Label is required'); return; }
    setBusy(true);
    try {
      const data = await createBeaconApi(label.trim(), expectedRegion.trim() || undefined);
      setRevealedSecret({ beaconKey: data.beaconKey, beaconSecret: data.beaconSecret, label: data.label });
      setCreateOpen(false);
      setLabel('');
      setExpectedRegion('');
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not create beacon');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (beacon) => {
    setBusy(true);
    try {
      await revokeBeaconApi(beacon.id);
      toast.success('Beacon revoked — its linked whitelist entry was NOT removed');
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not revoke beacon');
    } finally {
      setBusy(false);
    }
  };

  const resolveApproval = async (approvalId, decision) => {
    setBusy(true);
    try {
      await resolveBeaconApprovalApi(approvalId, decision);
      toast.success(decision === 'approved' ? 'IP applied' : 'Proposed IP rejected');
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not resolve');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {pending.length > 0 && (
        <Card>
          <CardHeader title="Pending IP approvals" subtitle="A beacon pushed an IP from an unexpected region — the old IP is still active until you decide." />
          <div className="px-5 pb-5 divide-y divide-border/60">
            {pending.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">
                    <span className="font-medium">{p.ip_beacons?.label}</span> proposed <span className="font-mono">{p.proposed_ip}</span>
                  </p>
                  <p className="text-xs text-fg-subtle">
                    Expected: {p.ip_beacons?.expected_region || 'not set'} · Detected: {p.detected_region || 'unknown'} · {formatDateTime(p.created_at)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" icon={Check} loading={busy} onClick={() => resolveApproval(p.id, 'approved')}>Approve</Button>
                  <Button size="sm" variant="outline" icon={X} loading={busy} onClick={() => resolveApproval(p.id, 'rejected')}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="IP Beacons"
          subtitle="Per-branch devices that push your office IP automatically — supports multiple branches."
          action={<Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>New beacon</Button>}
        />
        <div className="px-5 pb-5">
          {isLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : beacons.length === 0 ? (
            <EmptyState icon={Radio} title="No beacons yet" message="Create one per branch to auto-manage your office IP whitelist." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Label', 'Region', 'Last IP', 'Health', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2 font-semibold text-fg-subtle text-xs uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {beacons.map((b) => (
                  <tr key={b.id} className="border-b border-border/50">
                    <td className="py-2.5 text-fg font-medium">{b.label}</td>
                    <td className="py-2.5 text-fg-muted">{b.expected_region || '—'}</td>
                    <td className="py-2.5 font-mono text-xs text-fg-muted">{b.last_pushed_ip || '—'}</td>
                    <td className="py-2.5"><Badge tone={HEALTH_TONE[b.health] || 'neutral'}>{b.health.replace('_', ' ')}</Badge></td>
                    <td className="py-2.5 text-right">
                      {b.is_active && <Button size="sm" variant="outline" loading={busy} onClick={() => revoke(b)}>Revoke</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New IP beacon"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitCreate}>Create</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <Input label="Label" placeholder="e.g. Bangalore HQ" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input label="Expected region (optional)" placeholder="e.g. IN or Bangalore" value={expectedRegion} onChange={(e) => setExpectedRegion(e.target.value)} hint="Used to flag IP changes from an unexpected location." />
        </div>
      </Modal>

      <Modal
        open={Boolean(revealedSecret)}
        onClose={() => setRevealedSecret(null)}
        title="Beacon created — copy this now"
        footer={<Button onClick={() => setRevealedSecret(null)}>Done</Button>}
        dismissible={false}
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">The secret is shown only once and cannot be retrieved again.</p>
          <div className="rounded-lg border border-border/60 p-3 space-y-2 font-mono text-xs break-all">
            <p><span className="text-fg-subtle">Beacon key:</span> {revealedSecret?.beaconKey}</p>
            <p><span className="text-fg-subtle">Secret:</span> {revealedSecret?.beaconSecret}</p>
          </div>
          <p className="text-xs text-fg-subtle">
            Point your push app (e.g. MacroDroid) at:<br />
            <span className="font-mono">POST {`{API_URL}`}/attendance/ip-beacon/{revealedSecret?.beaconKey}/ping</span><br />
            Header: <span className="font-mono">X-Beacon-Secret: {'<secret>'}</span> · Body: empty
          </p>
        </div>
      </Modal>
    </>
  );
}
