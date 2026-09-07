import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CreditCard, Plus, Power } from 'lucide-react';
import { Card, CardHeader, Button, Badge, Skeleton, PageHeader, Modal, Input, Textarea, Toggle, ConfirmDialog } from '../../components/ui';
import { formatCurrency } from '../../lib/utils';
import { toSnakeCase } from '../../lib/case';
import { listPlansApi, createPlanApi, updatePlanApi, deactivatePlanApi } from '../../api/subscription.api';

/**
 * All 8 keys are enforced — see backend/src/middleware/featureGate.middleware.js
 * (training/assets/helpdesk/recruitment/reports/apiKey/integration/payroll
 * routes) and biometric_adms's dedicated attendance-visibility filter
 * (attendance.service.js) — device-punch ingestion itself is never gated,
 * only company-side display of biometric-sourced rows (see item 8's report).
 * Payroll defaults OFF for every plan — a full opt-in feature, unlike the
 * others, which default on for at least the Starter tier.
 */
const FEATURE_FLAGS = [
  { key: 'payroll', label: 'Payroll module (default: OFF — enable per company as needed)' },
  { key: 'biometricAdms', label: 'Biometric attendance visibility (data is always collected from registered devices; this only controls whether the company can see it)' },
  { key: 'advancedReports', label: 'Advanced reports' },
  { key: 'apiAccess', label: 'API access' },
  { key: 'training', label: 'Training / LMS' },
  { key: 'assets', label: 'Asset management' },
  { key: 'helpdesk', label: 'Helpdesk' },
  { key: 'recruitment', label: 'Recruitment (ATS)' },
  // Section B: baseline check-in methods — TRUE on every plan by default.
  { key: 'webCheckin', label: 'Web check-in' },
  { key: 'ipBasedWeb', label: 'IP-based web check-in' },
  { key: 'gpsGeofence', label: 'GPS geofencing' },
  // Paused platform-wide — see backend/src/config/featureRegistry.js. Shown
  // here for visibility only; the toggle itself is inert (backend rejects
  // enabling it) until MOBILE_APP_AVAILABLE is flipped.
  { key: 'appCheckin', label: 'App check-in — Coming soon (not toggleable yet)' },
  { key: 'ipBasedApp', label: 'IP-based app check-in — Coming soon (not toggleable yet)' },
];

const COMING_SOON_KEYS = ['appCheckin', 'ipBasedApp'];

const emptyForm = {
  name: '', code: '', description: '',
  basePriceMonthly: '', basePriceQuarterly: '', basePriceAnnual: '',
  pricePerSeatMonthly: '', pricePerSeatAnnual: '',
  includedSeats: '', maxSeats: '',
  features: {
    payroll: false, biometricAdms: false, advancedReports: false, apiAccess: false,
    training: true, assets: true, helpdesk: false, recruitment: false,
    webCheckin: true, ipBasedWeb: true, gpsGeofence: true, appCheckin: false, ipBasedApp: false,
  },
};

export default function PlansManagement() {
  const qc = useQueryClient();
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['super-admin', 'plans', 'all'],
    queryFn: () => listPlansApi(true),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (plan) => {
    setEditingId(plan.id);
    setForm({
      name: plan.name || '', code: plan.code || '', description: plan.description || '',
      basePriceMonthly: plan.basePriceMonthly ?? '', basePriceQuarterly: plan.basePriceQuarterly ?? '', basePriceAnnual: plan.basePriceAnnual ?? '',
      pricePerSeatMonthly: plan.pricePerSeatMonthly ?? '', pricePerSeatAnnual: plan.pricePerSeatAnnual ?? '',
      includedSeats: plan.includedSeats ?? '', maxSeats: plan.maxSeats ?? '',
      features: {
        payroll: false, biometricAdms: false, advancedReports: false, apiAccess: false,
        training: false, assets: false, helpdesk: false, recruitment: false,
        webCheckin: false, ipBasedWeb: false, gpsGeofence: false, appCheckin: false, ipBasedApp: false,
        ...(plan.features || {}),
      },
    });
    setFormOpen(true);
  };

  const setFeature = (key, value) => setForm((f) => ({ ...f, features: { ...f.features, [key]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = toSnakeCase({
        ...form,
        basePriceMonthly: Number(form.basePriceMonthly) || 0,
        basePriceQuarterly: Number(form.basePriceQuarterly) || 0,
        basePriceAnnual: Number(form.basePriceAnnual) || 0,
        pricePerSeatMonthly: Number(form.pricePerSeatMonthly) || 0,
        pricePerSeatAnnual: Number(form.pricePerSeatAnnual) || 0,
        includedSeats: Number(form.includedSeats) || 0,
        maxSeats: form.maxSeats === '' ? null : Number(form.maxSeats),
      });
      if (editingId) {
        delete payload.code; // never editable
        await updatePlanApi(editingId, payload);
        toast.success('Plan updated');
      } else {
        await createPlanApi(payload);
        toast.success('Plan created');
      }
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeactivate = async () => {
    setDeactivating(true);
    try {
      await deactivatePlanApi(deactivateTarget.id);
      toast.success('Plan deactivated');
      setDeactivateTarget(null);
      await qc.invalidateQueries({ queryKey: ['super-admin', 'plans'] });
    } catch (err) {
      toast.error(err.message || 'Deactivation failed');
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <PageHeader
        title="Plans"
        subtitle="Pricing tiers companies subscribe to. Deactivating a plan with active subscriptions is blocked."
        actions={<Button icon={Plus} onClick={openCreate}>New plan</Button>}
      />

      <Card>
        <CardHeader title="All plans" subtitle={isLoading ? 'Loading…' : `${plans.length} plan${plans.length === 1 ? '' : 's'}`} />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Plan', 'Monthly', 'Quarterly', 'Annual', 'Per seat (mo/yr)', 'Included seats', 'Max seats', 'Status', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-primary shrink-0" />
                        <div>
                          <p className="font-medium text-fg">{p.name}</p>
                          <p className="font-mono text-[11px] text-fg-subtle">{p.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(p.basePriceMonthly)}</td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(p.basePriceQuarterly)}</td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(p.basePriceAnnual)}</td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(p.pricePerSeatMonthly)} / {formatCurrency(p.pricePerSeatAnnual)}</td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{p.includedSeats}</td>
                    <td className="py-3 pr-3 text-fg-muted tabular-nums">{p.maxSeats ?? '∞'}</td>
                    <td className="py-3 pr-3">
                      <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}>Edit</Button>
                      {p.isActive && (
                        <Button size="sm" variant="outline" icon={Power} className="ml-2" onClick={() => setDeactivateTarget(p)}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit plan' : 'New plan'}
        size="lg"
        footer={(
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editingId ? 'Save changes' : 'Create plan'}</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Input
              label="Code"
              required
              disabled={Boolean(editingId)}
              hint={editingId ? 'Code cannot be changed after creation' : 'e.g. starter, growth'}
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
            />
          </div>
          <Textarea label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

          <div className="grid grid-cols-3 gap-4">
            <Input label="Base price / month" type="number" value={form.basePriceMonthly} onChange={(e) => setForm((f) => ({ ...f, basePriceMonthly: e.target.value }))} />
            <Input label="Base price / quarter" type="number" value={form.basePriceQuarterly} onChange={(e) => setForm((f) => ({ ...f, basePriceQuarterly: e.target.value }))} />
            <Input label="Base price / year" type="number" value={form.basePriceAnnual} onChange={(e) => setForm((f) => ({ ...f, basePriceAnnual: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Per-seat price / month" type="number" value={form.pricePerSeatMonthly} onChange={(e) => setForm((f) => ({ ...f, pricePerSeatMonthly: e.target.value }))} />
            <Input label="Per-seat price / year" type="number" value={form.pricePerSeatAnnual} onChange={(e) => setForm((f) => ({ ...f, pricePerSeatAnnual: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Included seats" type="number" hint="Free before per-seat charges kick in" value={form.includedSeats} onChange={(e) => setForm((f) => ({ ...f, includedSeats: e.target.value }))} />
            <Input label="Max seats" type="number" hint="Leave blank for unlimited" value={form.maxSeats} onChange={(e) => setForm((f) => ({ ...f, maxSeats: e.target.value }))} />
          </div>

          <div>
            <p className="text-xs font-medium text-fg-muted mb-2">Features</p>
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border p-4">
              {FEATURE_FLAGS.map((f) => {
                const comingSoon = COMING_SOON_KEYS.includes(f.key);
                return (
                  <Toggle
                    key={f.key}
                    label={f.label}
                    checked={comingSoon ? false : Boolean(form.features[f.key])}
                    disabled={comingSoon}
                    onChange={(v) => setFeature(f.key, v)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        loading={deactivating}
        tone="warning"
        title={`Deactivate ${deactivateTarget?.name}?`}
        message="Blocked automatically if any company still has an active subscription on this plan. New subscriptions won't be able to use it once deactivated."
        confirmLabel="Deactivate"
      />
    </div>
  );
}
