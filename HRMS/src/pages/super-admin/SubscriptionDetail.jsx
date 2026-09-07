import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Users, RefreshCw, Ban, Pause, Play, Building2 } from 'lucide-react';
import { Card, CardHeader, Button, StatusBadge, Skeleton, Modal, Input, Textarea, Select, ConfirmDialog } from '../../components/ui';
import { formatCurrency, formatDate, formatDateTime, humanize } from '../../lib/utils';
import {
  getSubscriptionApi, changeSeatsApi, changePlanApi, renewSubscriptionApi, manualRenewSubscriptionApi,
  cancelSubscriptionApi, suspendSubscriptionApi, reactivateSubscriptionApi, listPlansApi,
} from '../../api/subscription.api';

const ACTIVE_ACTION_STATUSES = ['trialing', 'active', 'past_due', 'grace_period'];

export default function SubscriptionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const queryKey = ['super-admin', 'subscriptions', id];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getSubscriptionApi(id) });
  const { data: plans = [] } = useQuery({ queryKey: ['super-admin', 'plans', 'all'], queryFn: () => listPlansApi(true) });

  const [modal, setModal] = useState(null); // 'seats' | 'plan' | 'manualRenew' | 'cancel' | 'suspend'
  const [busy, setBusy] = useState(false);
  const [seatCount, setSeatCount] = useState('');
  const [newPlanId, setNewPlanId] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [immediate, setImmediate] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);

  const closeModal = () => { setModal(null); setSeatCount(''); setNewPlanId(''); setPaymentReference(''); setNote(''); setReason(''); setImmediate(false); };

  const refresh = () => qc.invalidateQueries({ queryKey });

  const runAction = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
      closeModal();
      setConfirmReactivate(false);
      setConfirmRenew(false);
      await refresh();
      await qc.invalidateQueries({ queryKey: ['super-admin', 'billing'] });
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!data) return null;

  const { subscription: s, seatUsage, invoices = [], events = [], notifications = [] } = data;
  const canAct = ACTIVE_ACTION_STATUSES.includes(s.status);

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <button onClick={() => navigate('/super-admin/subscriptions')} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back to subscriptions
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-fg">{s.companies?.name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={s.status} />
              <span className="text-sm text-fg-muted">{s.plans?.name} · {s.billingCycle} · {s.seatCount} seats</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canAct && (
            <>
              <Button size="sm" variant="outline" icon={Users} onClick={() => { setSeatCount(String(s.seatCount)); setModal('seats'); }}>Change seats</Button>
              <Button size="sm" variant="outline" onClick={() => { setNewPlanId(s.planId); setModal('plan'); }}>Change plan</Button>
              <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => setConfirmRenew(true)}>Renew now</Button>
              <Button size="sm" variant="outline" onClick={() => setModal('manualRenew')}>Manual renew (offline)</Button>
              <Button size="sm" variant="outline" icon={Pause} onClick={() => setModal('suspend')}>Suspend</Button>
              <Button size="sm" variant="danger" icon={Ban} onClick={() => setModal('cancel')}>Cancel</Button>
            </>
          )}
          {s.status === 'suspended' && (
            <Button size="sm" icon={Play} onClick={() => setConfirmReactivate(true)}>Reactivate</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4"><p className="text-xs text-fg-subtle">Current price</p><p className="mt-1 text-lg font-semibold text-fg tabular-nums">{formatCurrency(s.priceLockedAtSignup)}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-subtle">Current period</p><p className="mt-1 text-sm font-medium text-fg">{formatDate(s.currentPeriodStart)} – {formatDate(s.currentPeriodEnd)}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-subtle">Next renewal</p><p className="mt-1 text-sm font-medium text-fg">{s.nextRenewalDate ? formatDate(s.nextRenewalDate) : '—'}{s.cancelAtPeriodEnd && <span className="block text-xs text-danger mt-0.5">Cancels at period end</span>}</p></Card>
        <Card className="p-4"><p className="text-xs text-fg-subtle">Seat usage</p><p className="mt-1 text-lg font-semibold text-fg tabular-nums">{seatUsage?.used ?? 0} / {seatUsage?.limit ?? s.seatCount}</p></Card>
      </div>

      <Card>
        <CardHeader title="Invoices" subtitle={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`} />
        <div className="overflow-x-auto px-5 pb-5">
          {invoices.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">No invoices yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Invoice', 'Amount', 'Status', 'Issued', 'Paid', 'Payment method'].map((h) => (
                    <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/60">
                    <td className="py-3 pr-3 font-mono text-xs text-fg">{inv.invoiceNumber}</td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(inv.amount)}</td>
                    <td className="py-3 pr-3"><StatusBadge status={inv.status} /></td>
                    <td className="py-3 pr-3 text-fg-subtle text-xs">{formatDate(inv.issuedAt)}</td>
                    <td className="py-3 pr-3 text-fg-subtle text-xs">{inv.paidAt ? formatDate(inv.paidAt) : '—'}</td>
                    <td className="py-3 pr-3 text-fg-subtle text-xs">{inv.paymentMethod || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Event history" subtitle="Audit trail — who did what, when" />
          <div className="px-5 pb-5">
            {events.length === 0 ? (
              <p className="text-sm text-fg-subtle py-6 text-center">No events yet.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="text-sm border-l-2 border-primary/30 pl-3">
                    <p className="font-medium text-fg">{humanize(e.eventType)}</p>
                    <p className="text-xs text-fg-subtle">{formatDateTime(e.createdAt)} · {humanize(e.triggeredBy)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Notifications sent" />
          <div className="px-5 pb-5">
            {notifications.length === 0 ? (
              <p className="text-sm text-fg-subtle py-6 text-center">No notifications sent yet.</p>
            ) : (
              <ol className="space-y-3">
                {notifications.map((n) => (
                  <li key={n.id} className="text-sm flex items-center justify-between">
                    <div>
                      <p className="font-medium text-fg">{humanize(n.notificationType)}</p>
                      <p className="text-xs text-fg-subtle">{n.sentTo} · {formatDateTime(n.sentAt)}</p>
                    </div>
                    <StatusBadge status={n.deliveryStatus === 'sent' ? 'active' : 'failed'} label={n.deliveryStatus} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>

      {/* Change seats */}
      <Modal
        open={modal === 'seats'} onClose={closeModal} title="Change seat count"
        footer={<><Button variant="outline" onClick={closeModal} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => runAction(() => changeSeatsApi(id, Number(seatCount)), 'Seat count updated')}>Save</Button></>}
      >
        <Input label="New seat count" type="number" min={1} value={seatCount} onChange={(e) => setSeatCount(e.target.value)} hint="Prorated for the remainder of the current period, applied on the next invoice." />
      </Modal>

      {/* Change plan */}
      <Modal
        open={modal === 'plan'} onClose={closeModal} title="Change plan"
        footer={<><Button variant="outline" onClick={closeModal} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => runAction(() => changePlanApi(id, newPlanId), 'Plan changed')}>Save</Button></>}
      >
        <Select label="New plan" value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Modal>

      {/* Manual renew */}
      <Modal
        open={modal === 'manualRenew'} onClose={closeModal} title="Manual renewal (offline payment)"
        footer={<><Button variant="outline" onClick={closeModal} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => runAction(() => manualRenewSubscriptionApi(id, paymentReference, note), 'Subscription renewed')}>Confirm renewal</Button></>}
      >
        <div className="space-y-4">
          <Input label="Payment reference" required placeholder="e.g. bank transfer UTR, cheque no." value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>

      {/* Suspend */}
      <Modal
        open={modal === 'suspend'} onClose={closeModal} title="Suspend subscription"
        footer={<><Button variant="outline" onClick={closeModal} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => runAction(() => suspendSubscriptionApi(id, reason), 'Subscription suspended')}>Suspend</Button></>}
      >
        <Textarea label="Reason" placeholder="e.g. terms violation" value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="mt-2 text-xs text-fg-subtle">Blocks login for this company's employees. Data is not touched.</p>
      </Modal>

      {/* Cancel */}
      <Modal
        open={modal === 'cancel'} onClose={closeModal} title="Cancel subscription"
        footer={<><Button variant="outline" onClick={closeModal} disabled={busy}>Back</Button><Button variant="danger" loading={busy} onClick={() => runAction(() => cancelSubscriptionApi(id, reason, immediate), immediate ? 'Subscription cancelled' : 'Will cancel at period end')}>Confirm cancellation</Button></>}
      >
        <div className="space-y-4">
          <Textarea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-3">
            <button type="button" onClick={() => setImmediate(false)} className={`flex-1 rounded-xl border p-3 text-left text-sm ${!immediate ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <p className="font-medium text-fg">At period end</p>
              <p className="text-xs text-fg-subtle mt-0.5">Access continues until {formatDate(s.currentPeriodEnd)}</p>
            </button>
            <button type="button" onClick={() => setImmediate(true)} className={`flex-1 rounded-xl border p-3 text-left text-sm ${immediate ? 'border-danger bg-danger/5' : 'border-border'}`}>
              <p className="font-medium text-fg">Immediately</p>
              <p className="text-xs text-fg-subtle mt-0.5">Access ends right away</p>
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmReactivate} onClose={() => setConfirmReactivate(false)} tone="primary"
        title="Reactivate subscription?" confirmLabel="Reactivate" loading={busy}
        onConfirm={() => runAction(() => reactivateSubscriptionApi(id), 'Subscription reactivated')}
      />
      <ConfirmDialog
        open={confirmRenew} onClose={() => setConfirmRenew(false)} tone="primary"
        title="Renew this subscription now?" message="Extends the current period by one billing cycle and creates a pending invoice." confirmLabel="Renew" loading={busy}
        onConfirm={() => runAction(() => renewSubscriptionApi(id), 'Subscription renewed')}
      />
    </div>
  );
}
