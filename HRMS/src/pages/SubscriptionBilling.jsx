import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  CreditCard, Check, Lock, Download, ArrowUpCircle, Users, RefreshCw, XCircle, Clock,
} from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, Badge, Skeleton, Modal, Input, Textarea, ProgressBar, EmptyState,
} from '../components/ui';
import { formatCurrency, formatDateTime } from '../lib/utils';
import {
  getMySubscriptionApi, getMyFeaturesApi, listMyInvoicesApi, getMyPaymentMethodApi,
  requestChangePlanApi, requestChangeSeatsApi, requestChangeBillingCycleApi, requestFeatureApi,
  cancelMySubscriptionApi, downloadMyInvoiceApi, listBillingPlansApi,
} from '../api/tenantBilling.api';
import { useCompanyStore } from '../store/companyStore';

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
};

export default function SubscriptionBilling() {
  const qc = useQueryClient();
  const companyName = useCompanyStore((s) => s.company.name);

  const { data: subscription, isLoading: subLoading } = useQuery({ queryKey: ['billing', 'my-subscription'], queryFn: getMySubscriptionApi });
  const { data: features = [], isLoading: featuresLoading } = useQuery({ queryKey: ['billing', 'my-features'], queryFn: getMyFeaturesApi });
  const { data: invoicesResult } = useQuery({ queryKey: ['billing', 'my-invoices'], queryFn: () => listMyInvoicesApi({ page: 1, limit: 20 }) });
  const { data: paymentMethod } = useQuery({ queryKey: ['billing', 'my-payment-method'], queryFn: getMyPaymentMethodApi });
  const { data: plans = [] } = useQuery({ queryKey: ['billing', 'plans'], queryFn: listBillingPlansApi });

  const [lockedFeature, setLockedFeature] = useState(null);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [changeSeatsOpen, setChangeSeatsOpen] = useState(false);
  const [changeCycleOpen, setChangeCycleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const invalidateSub = () => qc.invalidateQueries({ queryKey: ['billing', 'my-subscription'] });

  if (subLoading) return <Skeleton className="h-96 w-full rounded-xl" />;

  if (!subscription) {
    return (
      <div className="max-w-2xl mx-auto">
        <PageHeader title="Subscription & Billing" />
        <EmptyState icon={CreditCard} title="No active subscription" message="Contact your account administrator to set up billing for your company." />
      </div>
    );
  }

  const renewalDays = daysUntil(subscription.nextRenewalDate);
  const seatPct = subscription.seatUsage?.limit ? (subscription.seatUsage.used / subscription.seatUsage.limit) * 100 : 0;
  const seatTone = seatPct >= 90 ? 'danger' : seatPct >= 70 ? 'warning' : 'primary';

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <PageHeader title="Subscription & Billing" subtitle="Manage your company's plan, seats, and invoices." />

      <Card>
        <CardHeader
          title={subscription.planName}
          subtitle={`${formatCurrency(subscription.price)} / ${subscription.billingCycle}`}
          action={<Badge tone={['active', 'trialing'].includes(subscription.status) ? 'success' : 'warning'}>{subscription.status}</Badge>}
        />
        <div className="px-5 pb-5 space-y-4">
          {renewalDays != null && renewalDays <= 30 && (
            <div className="rounded-lg bg-warning/10 text-warning text-sm px-3 py-2 flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0" />
              Renews in {renewalDays} day{renewalDays === 1 ? '' : 's'} ({formatDateTime(subscription.nextRenewalDate)})
              {subscription.cancelAtPeriodEnd && ' — cancellation scheduled for this date'}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-fg-subtle">Seats used</span>
              <span className="font-medium text-fg tabular-nums">{subscription.seatUsage?.used} / {subscription.seatUsage?.limit ?? '∞'}</span>
            </div>
            <ProgressBar value={seatPct} tone={seatTone} />
          </div>
          <p className="text-xs text-fg-subtle">Auto-renew: {subscription.autoRenew ? 'On' : 'Off'}</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Actions" />
        <div className="px-5 pb-5 flex flex-wrap gap-3">
          <Button variant="outline" icon={ArrowUpCircle} onClick={() => setChangePlanOpen(true)}>Change Plan</Button>
          <Button variant="outline" icon={Users} onClick={() => setChangeSeatsOpen(true)}>Add/Remove Seats</Button>
          <Button variant="outline" icon={RefreshCw} onClick={() => setChangeCycleOpen(true)}>Change Billing Cycle</Button>
        </div>
        <div className="px-5 pb-5">
          <button type="button" onClick={() => setCancelOpen(true)} className="text-xs text-fg-subtle hover:text-danger underline underline-offset-2">
            Cancel Subscription
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Features" subtitle="What's included on your plan" />
        <div className="px-5 pb-5">
          {featuresLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : (
            <div className="divide-y divide-border/60">
              {features.filter((f) => !f.comingSoon).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => !f.effective && setLockedFeature(f)}
                  className="w-full flex items-center justify-between py-2.5 text-left disabled:cursor-default"
                  disabled={f.effective}
                >
                  <span className="text-sm text-fg">{f.label}</span>
                  {f.effective ? (
                    <span className="flex items-center gap-1.5 text-success text-xs font-medium"><Check className="h-4 w-4" /> Enabled</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-fg-subtle text-xs font-medium"><Lock className="h-4 w-4" /> Locked</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Invoices" subtitle={`${invoicesResult?.meta?.total ?? 0} total`} />
        <div className="px-5 pb-5 overflow-x-auto">
          {(invoicesResult?.items || []).length === 0 ? (
            <p className="text-sm text-fg-subtle py-6 text-center">No invoices yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Invoice #', 'Amount', 'Status', 'Issued', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2 font-semibold text-fg-subtle text-xs uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(invoicesResult?.items || []).map((inv) => (
                  <tr key={inv.id} className="border-b border-border/60">
                    <td className="py-2.5 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="py-2.5">{formatCurrency(inv.amount)}</td>
                    <td className="py-2.5"><Badge tone={inv.status === 'paid' ? 'success' : 'warning'}>{inv.status}</Badge></td>
                    <td className="py-2.5 text-fg-subtle text-xs">{formatDateTime(inv.issuedAt)}</td>
                    <td className="py-2.5 text-right">
                      <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadMyInvoiceApi(inv.id).catch((e) => toast.error(e.message))}>PDF</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment Method" />
        <div className="px-5 pb-5">
          <p className="text-sm text-fg-subtle">
            {paymentMethod?.configured ? paymentMethod.masked : (paymentMethod?.note || 'Not yet configured, contact billing.')}
          </p>
        </div>
      </Card>

      <LockedFeatureModal feature={lockedFeature} onClose={() => setLockedFeature(null)} onUpgrade={() => { setLockedFeature(null); setChangePlanOpen(true); }} />
      <ChangePlanModal open={changePlanOpen} onClose={() => setChangePlanOpen(false)} plans={plans} currentPlanCode={subscription.planCode} onDone={invalidateSub} />
      <ChangeSeatsModal open={changeSeatsOpen} onClose={() => setChangeSeatsOpen(false)} currentSeats={subscription.seatUsage?.limit} onDone={invalidateSub} />
      <ChangeCycleModal open={changeCycleOpen} onClose={() => setChangeCycleOpen(false)} currentCycle={subscription.billingCycle} onDone={invalidateSub} />
      <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} companyName={companyName} subscription={subscription} onDone={invalidateSub} />
    </div>
  );
}

function LockedFeatureModal({ feature, onClose, onUpgrade }) {
  const [busy, setBusy] = useState(false);
  if (!feature) return null;

  const submitRequest = async () => {
    setBusy(true);
    try {
      await requestFeatureApi(feature.key);
      toast.success('Request submitted — our team will reach out');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not submit request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={feature.label}
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {feature.selfServeUnlockable ? (
            <Button icon={ArrowUpCircle} onClick={onUpgrade}>Upgrade Now</Button>
          ) : (
            <Button loading={busy} onClick={submitRequest}>Request This Feature</Button>
          )}
        </div>
      )}
    >
      <p className="text-sm text-fg-subtle">
        {feature.selfServeUnlockable
          ? "This feature isn't included in your current plan. Upgrade to unlock it instantly."
          : "This feature requires a conversation with our team before it can be enabled. Request it and we'll follow up."}
      </p>
    </Modal>
  );
}

function ChangePlanModal({ open, onClose, plans, currentPlanCode, onDone }) {
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!planId) { toast.error('Select a plan'); return; }
    setBusy(true);
    try {
      await requestChangePlanApi(planId);
      toast.success('Plan change requested — billing will follow up shortly');
      onClose();
      await onDone?.();
    } catch (err) {
      toast.error(err.message || 'Could not request plan change');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change plan" footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Request change</Button></div>}>
      <div className="space-y-3">
        <p className="text-xs text-fg-subtle">No payment gateway is connected yet — this submits a request that billing will complete manually.</p>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
          <option value="">Select a plan…</option>
          {plans.map((p) => <option key={p.id} value={p.id} disabled={p.code === currentPlanCode}>{p.name}{p.code === currentPlanCode ? ' (current)' : ''}</option>)}
        </select>
      </div>
    </Modal>
  );
}

function ChangeSeatsModal({ open, onClose, currentSeats, onDone }) {
  const [seatCount, setSeatCount] = useState(currentSeats || '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!seatCount || Number(seatCount) < 1) { toast.error('Enter a valid seat count'); return; }
    setBusy(true);
    try {
      await requestChangeSeatsApi(Number(seatCount));
      toast.success('Seat change requested — billing will follow up shortly');
      onClose();
      await onDone?.();
    } catch (err) {
      toast.error(err.message || 'Could not request seat change');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add / remove seats" footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Request change</Button></div>}>
      <Input label="New total seat count" type="number" min="1" value={seatCount} onChange={(e) => setSeatCount(e.target.value)} />
    </Modal>
  );
}

function ChangeCycleModal({ open, onClose, currentCycle, onDone }) {
  const [cycle, setCycle] = useState(currentCycle || 'monthly');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await requestChangeBillingCycleApi(cycle);
      toast.success('Billing cycle change requested — billing will follow up shortly');
      onClose();
      await onDone?.();
    } catch (err) {
      toast.error(err.message || 'Could not request cycle change');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change billing cycle" footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Request change</Button></div>}>
      <select value={cycle} onChange={(e) => setCycle(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
        <option value="annual">Annual</option>
      </select>
    </Modal>
  );
}

/** Retention screen: shows what they lose + current usage, requires typing the company name. */
function CancelModal({ open, onClose, companyName, subscription, onDone }) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = confirmText.trim().toLowerCase() === String(companyName || '').trim().toLowerCase();

  const submit = async () => {
    if (!matches) { toast.error('Company name does not match'); return; }
    setBusy(true);
    try {
      await cancelMySubscriptionApi(reason, confirmText);
      toast.success('Cancellation processed');
      onClose();
      setConfirmText('');
      setReason('');
      await onDone?.();
    } catch (err) {
      toast.error(err.message || 'Could not process cancellation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel subscription"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Keep my subscription</Button>
          <Button variant="danger" icon={XCircle} disabled={!matches} loading={busy} onClick={submit}>Cancel subscription</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-danger/10 text-sm p-3 space-y-1">
          <p className="font-medium text-danger">You'll lose access to:</p>
          <ul className="list-disc list-inside text-fg-subtle">
            <li>{subscription?.planName} plan features after the current period ends</li>
            <li>{subscription?.seatUsage?.used} active employee seat(s) currently in use</li>
          </ul>
        </div>
        <p className="text-xs text-fg-subtle">Cancellation takes effect at the end of your current billing period ({formatDateTime(subscription?.nextRenewalDate)}) — you keep access until then.</p>
        <Textarea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Input label={`Type "${companyName}" to confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      </div>
    </Modal>
  );
}
