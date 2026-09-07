import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Building2, Power, UserCog, StickyNote, Receipt, ScrollText, Gauge, ToggleLeft, ArrowLeft, Plus, Trash2,
} from 'lucide-react';
import {
  Card, CardHeader, Button, Badge, Skeleton, Tabs, Textarea, Modal, Input, Select, Toggle, EmptyState, Field,
} from '../../components/ui';
import { formatDateTime, formatCurrency } from '../../lib/utils';
import {
  getCompanyProfileApi, updateCompanyProfileApi, listCompanyEmployeesApi, getCompanySubscriptionDetailApi,
  getCompanyUsageApi, getCompanyAuditLogApi, listCompanyNotesApi, addCompanyNoteApi, deleteCompanyNoteApi,
  suspendCompanyApi, reactivateCompanyApi, startImpersonationApi, getCompanyFeaturesApi, setCompanyFeatureApi,
  clearCompanyFeatureApi, setSeatOverrideApi,
} from '../../api/superAdmin.api';
import {
  issueManualCreditApi, issueManualInvoiceApi, recordInvoicePaymentApi, extendSubscriptionApi, setExportOverrideApi,
  listPlansApi, createSubscriptionApi, setDataCollectionModeApi,
} from '../../api/subscription.api';

// Item 7/8: explicit, non-generic labels for the two full-opt-in modules —
// a raw key like "payroll" doesn't communicate the default-off/visibility-
// only nature a super-admin needs to know before toggling it.
const FEATURE_LABELS = {
  payroll: 'Payroll',
  biometric_adms: 'Biometric attendance visibility (data is always collected from registered devices; this only controls whether the company can see it)',
  web_checkin: 'Web check-in',
  ip_based_web: 'IP-based web check-in',
  gps_geofence: 'GPS geofencing',
  app_checkin: 'App check-in',
  ip_based_app: 'IP-based app check-in',
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'employees', label: 'Employees', icon: UserCog },
  { id: 'billing', label: 'Subscription & Billing', icon: Receipt },
  { id: 'features', label: 'Features & Limits', icon: ToggleLeft },
  { id: 'activity', label: 'Activity Log', icon: ScrollText },
  { id: 'notes', label: 'Internal Notes', icon: StickyNote },
];

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['super-admin', 'company', id, 'profile'],
    queryFn: () => getCompanyProfileApi(id),
  });

  const toggleActive = async () => {
    setBusy(true);
    try {
      if (profile?.isActive) {
        await suspendCompanyApi(id);
        toast.success('Company suspended');
      } else {
        await reactivateCompanyApi(id);
        toast.success('Company reactivated');
      }
      await qc.invalidateQueries({ queryKey: ['super-admin', 'company', id, 'profile'] });
    } catch (err) {
      toast.error(err.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const submitImpersonate = async () => {
    if (!impersonateReason.trim()) {
      toast.error('A reason is required');
      return;
    }
    setBusy(true);
    try {
      const result = await startImpersonationApi(id, impersonateReason.trim());
      toast.success(`Impersonation session started for ${result.targetEmployee?.name || 'admin'}`);
      // The backend already set the accessToken cookie on this response —
      // a new tab against the app just picks it up, same as any login.
      window.open('/dashboard', '_blank');
      setImpersonateOpen(false);
      setImpersonateReason('');
    } catch (err) {
      toast.error(err.message || 'Could not start impersonation');
    } finally {
      setBusy(false);
    }
  };

  if (profileLoading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  if (!profile) {
    return <EmptyState icon={Building2} title="Company not found" />;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/super-admin/companies')}>
        Back to Companies
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-fg">{profile.name}</h1>
              <Badge tone={profile.isActive ? 'success' : 'neutral'}>{profile.isActive ? 'Active' : 'Inactive'}</Badge>
              {profile.companyType && profile.companyType !== 'standalone' && <Badge tone="info">{profile.companyType}</Badge>}
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              {profile.slug} · {profile.employeeCount} employees · created {formatDateTime(profile.createdAt)}
            </p>
            {profile.adminContact && (
              <p className="mt-0.5 text-xs text-fg-subtle">
                Admin contact: {profile.adminContact.firstName} {profile.adminContact.lastName} ({profile.adminContact.email})
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={UserCog} onClick={() => setImpersonateOpen(true)}>Impersonate</Button>
          <Button variant={profile.isActive ? 'danger' : 'primary'} icon={Power} loading={busy} onClick={toggleActive}>
            {profile.isActive ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab companyId={id} />}
      {tab === 'employees' && <EmployeesTab companyId={id} />}
      {tab === 'billing' && <BillingTab companyId={id} />}
      {tab === 'features' && <FeaturesTab companyId={id} />}
      {tab === 'activity' && <ActivityTab companyId={id} />}
      {tab === 'notes' && <NotesTab companyId={id} />}

      <Modal
        open={impersonateOpen}
        onClose={() => setImpersonateOpen(false)}
        title="Impersonate this company's admin"
        subtitle="A reason is required and every action is logged. The session expires automatically after 45 minutes."
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImpersonateOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitImpersonate}>Start session</Button>
          </div>
        )}
      >
        <Textarea
          label="Reason"
          placeholder="e.g. Investigating a support ticket about payroll access"
          value={impersonateReason}
          onChange={(e) => setImpersonateReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}

function OverviewTab({ companyId }) {
  const qc = useQueryClient();
  const { data: usage, isLoading } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'usage'],
    queryFn: () => getCompanyUsageApi(companyId),
  });
  const { data: profile } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'profile'],
    queryFn: () => getCompanyProfileApi(companyId),
  });
  const [editing, setEditing] = useState(false);
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const startEdit = () => {
    setIndustry(profile?.industry || '');
    setCompanySize(profile?.companySize || '');
    setEditing(true);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await updateCompanyProfileApi(companyId, { industry, company_size: companySize });
      toast.success('Profile updated');
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['super-admin', 'company', companyId, 'profile'] });
    } catch (err) {
      toast.error(err.message || 'Could not update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  const adoption = usage?.featureAdoption || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="md:col-span-2">
        <CardHeader
          title="Company profile"
          action={editing ? null : <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button>}
        />
        <div className="px-5 pb-5">
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Retail, SaaS, Manufacturing" />
              <Input label="Company size" value={companySize} onChange={(e) => setCompanySize(e.target.value)} placeholder="e.g. 11-50" />
              <div className="sm:col-span-2 flex gap-2">
                <Button size="sm" loading={savingProfile} onClick={saveProfile}>Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-8 text-sm">
              <div><p className="text-fg-subtle text-xs">Industry</p><p className="text-fg">{profile?.industry || '—'}</p></div>
              <div><p className="text-fg-subtle text-xs">Company size</p><p className="text-fg">{profile?.companySize || '—'}</p></div>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Login activity" subtitle="Last 30 days" />
        <div className="px-5 pb-5">
          <p className="text-3xl font-semibold text-fg">{usage?.activeLogins30d ?? 0}</p>
          <p className="text-sm text-fg-subtle">distinct employees logged in</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Feature adoption" />
        <div className="px-5 pb-5 grid grid-cols-2 gap-3">
          {['payroll', 'adms', 'training', 'assets'].map((key) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
              <span className="text-sm text-fg capitalize">{key}</span>
              <Badge tone={adoption[key] ? 'success' : 'neutral'}>{adoption[key] ? 'In use' : 'Not used'}</Badge>
            </div>
          ))}
        </div>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader title="Documents" subtitle={usage?.storageNote} />
        <div className="px-5 pb-5">
          <p className="text-3xl font-semibold text-fg">{usage?.documentCount ?? 0}</p>
          <p className="text-sm text-fg-subtle">documents uploaded (byte-size tracking is not implemented)</p>
        </div>
      </Card>
    </div>
  );
}

function EmployeesTab({ companyId }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'employees', page],
    queryFn: () => listCompanyEmployeesApi(companyId, { page, limit: 20 }),
    keepPreviousData: true,
  });
  const rows = data?.items || [];
  const meta = data?.meta;

  return (
    <Card>
      <CardHeader title="Employees" subtitle={meta ? `${meta.total} total` : ''} />
      <div className="overflow-x-auto px-5 pb-5">
        {isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : rows.length === 0 ? (
          <p className="text-sm text-fg-subtle py-8 text-center">No employees found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['Name', 'Email', 'Role', 'Department', 'Status'].map((h) => (
                  <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-3 text-fg font-medium">{e.firstName} {e.lastName}</td>
                  <td className="py-2.5 pr-3 text-fg-muted">{e.email}</td>
                  <td className="py-2.5 pr-3 text-fg-muted capitalize">{e.role}</td>
                  <td className="py-2.5 pr-3 text-fg-muted">{e.department || '—'}</td>
                  <td className="py-2.5 pr-3"><Badge tone={e.isActive ? 'success' : 'neutral'}>{e.isActive ? 'Active' : 'Inactive'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {meta && meta.totalPages > 1 && (
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-xs text-fg-subtle self-center">Page {page} of {meta.totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function BillingTab({ companyId }) {
  const qc = useQueryClient();
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDescription, setInvoiceDescription] = useState('');
  const [invoiceReference, setInvoiceReference] = useState('');
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDays, setExtendDays] = useState('');
  const [extendReason, setExtendReason] = useState('');
  const [paymentTarget, setPaymentTarget] = useState(null); // invoice being recorded against
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'subscription'],
    queryFn: () => getCompanySubscriptionDetailApi(companyId),
  });

  const invalidateSub = () => qc.invalidateQueries({ queryKey: ['super-admin', 'company', companyId, 'subscription'] });

  const submitCredit = async () => {
    if (!creditAmount || !creditReason.trim()) {
      toast.error('Amount and reason are required');
      return;
    }
    setBusy(true);
    try {
      await issueManualCreditApi(companyId, Number(creditAmount), creditReason.trim());
      toast.success('Credit issued');
      setCreditOpen(false);
      setCreditAmount('');
      setCreditReason('');
      await invalidateSub();
    } catch (err) {
      toast.error(err.message || 'Could not issue credit');
    } finally {
      setBusy(false);
    }
  };

  const submitInvoice = async () => {
    if (!invoiceAmount || !invoiceDescription.trim() || !invoiceReference.trim()) {
      toast.error('Amount, description, and a payment reference are all required');
      return;
    }
    setBusy(true);
    try {
      await issueManualInvoiceApi(companyId, Number(invoiceAmount), invoiceDescription.trim(), invoiceReference.trim());
      toast.success('Manual invoice recorded');
      setInvoiceOpen(false);
      setInvoiceAmount('');
      setInvoiceDescription('');
      setInvoiceReference('');
      await invalidateSub();
    } catch (err) {
      toast.error(err.message || 'Could not record invoice');
    } finally {
      setBusy(false);
    }
  };

  const submitExtend = async () => {
    if (!extendDays || !extendReason.trim()) {
      toast.error('Number of days and a reason are required');
      return;
    }
    setBusy(true);
    try {
      await extendSubscriptionApi(companyId, { days: Number(extendDays), reason: extendReason.trim() });
      toast.success('Subscription extended');
      setExtendOpen(false);
      setExtendDays('');
      setExtendReason('');
      await invalidateSub();
    } catch (err) {
      toast.error(err.message || 'Could not extend subscription');
    } finally {
      setBusy(false);
    }
  };

  const openPayment = (inv) => {
    setPaymentTarget(inv);
    setPaymentMethod('');
    setPaymentReference('');
    setPaymentAmount(String(Number(inv.amount) - Number(inv.amountPaid || 0)));
    setPaymentNote('');
  };

  const submitPayment = async () => {
    if (!paymentMethod || !paymentReference.trim()) {
      toast.error('Payment method and a reference/note are required');
      return;
    }
    setBusy(true);
    try {
      await recordInvoicePaymentApi(paymentTarget.id, {
        paymentMethod,
        reference: paymentReference.trim(),
        amountReceived: Number(paymentAmount),
        note: paymentNote.trim() || undefined,
      });
      toast.success('Payment recorded');
      setPaymentTarget(null);
      await invalidateSub();
    } catch (err) {
      toast.error(err.message || 'Could not record payment');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;

  const sub = data?.subscription;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Subscription"
          subtitle={sub ? `${sub.plans?.name} · ${sub.billingCycle} · ${sub.seatCount} seats` : 'No subscription'}
        />
        {sub && (
          <div className="px-5 pb-5 flex flex-wrap gap-3">
            <Badge tone={sub.status === 'active' ? 'success' : sub.status === 'suspended' ? 'danger' : 'warning'}>{sub.status}</Badge>
            <span className="text-sm text-fg-subtle">Renews {formatDateTime(sub.nextRenewalDate)}</span>
          </div>
        )}
      </Card>

      {!sub && <AssignSubscriptionCard companyId={companyId} onAssigned={invalidateSub} />}

      {sub && (
        <Card>
          <CardHeader title="Billing actions" subtitle="Three distinct actions — read the description before using one." />
          <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border/60 p-4 flex flex-col gap-2">
              <p className="text-sm font-semibold text-fg">Extend Subscription</p>
              <p className="text-xs text-fg-subtle flex-1">
                Push out this company's renewal date without charging them — use for goodwill extensions or payment
                processing delays. Does not affect what they owe.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExtendOpen(true)}
                title="Push out this company's renewal date without charging them — use for goodwill extensions or payment processing delays. Does not affect what they owe."
              >
                Extend Subscription
              </Button>
            </div>
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-4 flex flex-col gap-2">
              <p className="text-sm font-semibold text-fg">Manual Credit</p>
              <p className="text-xs text-fg-subtle flex-1">
                Apply a discount or goodwill adjustment to this company's next invoice — does not change their
                subscription status or renewal date.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreditOpen(true)}
                title="Apply a discount or goodwill adjustment to this company's next invoice — does not change their subscription status or renewal date."
              >
                Manual Credit
              </Button>
            </div>
            <div className="rounded-xl border border-success/40 bg-success/5 p-4 flex flex-col gap-2">
              <p className="text-sm font-semibold text-fg">Create Manual Invoice</p>
              <p className="text-xs text-fg-subtle flex-1">
                Record an offline/bank-transfer payment as a paid invoice — use this when a company pays outside the
                automated billing cycle.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setInvoiceOpen(true)}
                title="Record an offline/bank-transfer payment as a paid invoice — use this when a company pays outside the automated billing cycle."
              >
                Create Manual Invoice
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Invoices"
          subtitle={`${data?.invoices?.length || 0} total · "Record Payment" reconciles an offline payment against an invoice that already exists — for a brand-new paid invoice use "Create Manual Invoice" above instead.`}
        />
        <div className="overflow-x-auto px-5 pb-5">
          {(data?.invoices || []).length === 0 ? (
            <p className="text-sm text-fg-subtle py-6 text-center">No invoices yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Invoice #', 'Amount', 'Status', 'Issued', ''].map((h) => (
                    <th key={h} className="py-2 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => {
                  const settled = ['paid', 'refunded', 'void'].includes(inv.status);
                  return (
                    <tr key={inv.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono text-xs">{inv.invoiceNumber}</td>
                      <td className="py-2 pr-3">{formatCurrency(inv.amount)}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={inv.status === 'paid' ? 'success' : inv.status === 'failed' ? 'danger' : inv.status === 'partially_paid' ? 'warning' : 'warning'}>
                          {inv.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-fg-subtle text-xs">{formatDateTime(inv.issuedAt)}</td>
                      <td className="py-2 pr-3 text-right">
                        {!settled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openPayment(inv)}
                            title="Reconcile an offline payment (bank transfer/cheque/cash) already received against this existing invoice."
                          >
                            Record Payment
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Events" subtitle={`${data?.events?.length || 0} total`} />
        <div className="px-5 pb-5 divide-y divide-border/60 max-h-80 overflow-y-auto">
          {(data?.events || []).map((ev) => (
            <div key={ev.id} className="py-2 text-sm flex justify-between">
              <span className="text-fg">{ev.eventType.replace('_', ' ')}</span>
              <span className="text-fg-subtle text-xs">{formatDateTime(ev.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={creditOpen}
        onClose={() => setCreditOpen(false)}
        title="Issue manual credit"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreditOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitCredit}>Issue credit</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">Reduces what this company owes — does not change subscription status or renewal date.</p>
          <Input label="Amount (INR)" type="number" min="0" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
          <Textarea label="Reason" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
        title="Create manual invoice"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitInvoice}>Record invoice</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">Records a payment already received outside the normal billing cycle (bank transfer, cash, a one-off charge) as a paid invoice.</p>
          <Input label="Amount (INR)" type="number" min="0" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
          <Input label="Description" placeholder="e.g. Custom onboarding fee" value={invoiceDescription} onChange={(e) => setInvoiceDescription(e.target.value)} />
          <Input label="Payment reference" placeholder="e.g. Bank transfer ref #12345" value={invoiceReference} onChange={(e) => setInvoiceReference(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={extendOpen}
        onClose={() => setExtendOpen(false)}
        title="Extend subscription"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExtendOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitExtend}>Extend</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">Pushes out the renewal date without creating an invoice or changing subscription status.</p>
          <Input label="Days to add" type="number" min="1" placeholder="e.g. 14" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} />
          <Textarea label="Reason" value={extendReason} onChange={(e) => setExtendReason(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={Boolean(paymentTarget)}
        onClose={() => setPaymentTarget(null)}
        title={`Record payment — ${paymentTarget?.invoiceNumber || ''}`}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaymentTarget(null)}>Cancel</Button>
            <Button loading={busy} onClick={submitPayment}>Record payment</Button>
          </div>
        )}
      >
        {paymentTarget && (
          <div className="space-y-3">
            <p className="text-xs text-fg-subtle">
              Reconciles an offline payment against this EXISTING invoice — does not create a new one. Outstanding
              balance: {formatCurrency(Number(paymentTarget.amount) - Number(paymentTarget.amountPaid || 0))}.
            </p>
            <Select
              label="Payment method"
              placeholder="Select method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              options={[
                { value: 'bank_transfer', label: 'Bank transfer' },
                { value: 'cheque', label: 'Cheque' },
                { value: 'cash', label: 'Cash' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <Input label="Reference / note" placeholder="e.g. Bank ref #12345" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
            <Input label="Amount received (INR)" type="number" min="0" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            {Number(paymentAmount) !== (Number(paymentTarget.amount) - Number(paymentTarget.amountPaid || 0)) && (
              <Textarea
                label="Explain the difference from the outstanding balance (required)"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Item 5: shown instead of an empty billing tab when a company has no live subscription. */
function AssignSubscriptionCard({ companyId, onAssigned }) {
  const { data: plans = [] } = useQuery({ queryKey: ['super-admin', 'plans', 'active'], queryFn: () => listPlansApi(false) });
  const [planId, setPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [seatCount, setSeatCount] = useState('10');
  const [initialStatus, setInitialStatus] = useState('trialing');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!planId || !seatCount) {
      toast.error('Plan and seat count are required');
      return;
    }
    setBusy(true);
    try {
      await createSubscriptionApi({
        company_id: companyId, plan_id: planId, billing_cycle: billingCycle,
        seat_count: Number(seatCount), initial_status: initialStatus,
      });
      toast.success('Subscription assigned');
      await onAssigned?.();
    } catch (err) {
      toast.error(err.message || 'Could not assign subscription');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="No active subscription" subtitle="This company has no live subscription — assign one to enable billing and feature gating." />
      <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Plan">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
            <option value="">Select a plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Billing cycle">
          <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </Field>
        <Input label="Seat count" type="number" min="1" value={seatCount} onChange={(e) => setSeatCount(e.target.value)} />
        <Field label="Start as">
          <select value={initialStatus} onChange={(e) => setInitialStatus(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm">
            <option value="trialing">Trialing (no invoice yet)</option>
            <option value="active">Active (invoice created now)</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Button loading={busy} onClick={submit}>Assign Subscription</Button>
        </div>
      </div>
    </Card>
  );
}

function FeaturesTab({ companyId }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'features'],
    queryFn: () => getCompanyFeaturesApi(companyId),
  });
  const { data: profile } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'profile'],
    queryFn: () => getCompanyProfileApi(companyId),
  });
  const [seatValue, setSeatValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportOverrideOpen, setExportOverrideOpen] = useState(false);
  const [exportOverrideReason, setExportOverrideReason] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['super-admin', 'company', companyId, 'features'] });

  const toggleFeature = async (feature) => {
    setBusy(true);
    try {
      await setCompanyFeatureApi(companyId, feature.key, !feature.effective, feature.isOverridden ? feature.overrideReason : 'Set from super-admin console');
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not update feature');
    } finally {
      setBusy(false);
    }
  };

  const resetFeature = async (feature) => {
    setBusy(true);
    try {
      await clearCompanyFeatureApi(companyId, feature.key);
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not clear override');
    } finally {
      setBusy(false);
    }
  };

  const submitSeatOverride = async () => {
    setBusy(true);
    try {
      await setSeatOverrideApi(companyId, seatValue === '' ? null : Number(seatValue));
      toast.success('Seat override updated');
      setSeatValue('');
    } catch (err) {
      toast.error(err.message || 'Could not update seat override');
    } finally {
      setBusy(false);
    }
  };

  const [dataModeTarget, setDataModeTarget] = useState(null); // feature object being switched to 'stop'
  const [dataModeConfirmed, setDataModeConfirmed] = useState(false);
  const [dataModeReason, setDataModeReason] = useState('');

  const STOP_COPY = {
    payroll: 'Stopping data collection for Payroll means no payroll will be calculated or recorded for this company, even internally, from this point forward. Existing historical payslips are not affected. This is different from just hiding the module. Are you sure?',
    biometric_adms: "Stopping data collection for Biometric Attendance means punches from this company's devices will stop being saved after a short grace period. Existing historical attendance is not affected. Are you sure?",
  };

  const setDataMode = async (feature, mode, reason, confirmed) => {
    setBusy(true);
    try {
      await setDataCollectionModeApi(companyId, feature.key, mode, reason, confirmed);
      toast.success(mode === 'stop' ? 'Data collection stopped' : 'Data collection resumed');
      setDataModeTarget(null);
      setDataModeReason('');
      setDataModeConfirmed(false);
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not update data collection mode');
    } finally {
      setBusy(false);
    }
  };

  const exportOverrideEnabled = Boolean(profile?.exportOverrideEnabled);

  const submitExportOverride = async (enable) => {
    if (enable && !exportOverrideReason.trim()) {
      toast.error('A reason is required');
      return;
    }
    setBusy(true);
    try {
      await setExportOverrideApi(companyId, enable, enable ? exportOverrideReason.trim() : 'Override disabled');
      toast.success(enable ? 'Export override enabled' : 'Export override disabled');
      setExportOverrideOpen(false);
      setExportOverrideReason('');
      await qc.invalidateQueries({ queryKey: ['super-admin', 'company', companyId, 'profile'] });
    } catch (err) {
      toast.error(err.message || 'Could not update export override');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  const features = data?.features || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Feature flags" subtitle="Plan defaults, with per-company overrides" />
        <div className="px-5 pb-5">
          {features.length === 0 ? (
            <p className="text-sm text-fg-subtle py-6 text-center">This company's plan has no feature flags defined.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {features.map((f) => (
                <div key={f.key} className="py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-fg flex items-center gap-2">
                        {FEATURE_LABELS[f.key] || f.key}
                        {f.comingSoon && <Badge tone="neutral">Coming soon</Badge>}
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {f.comingSoon
                          ? 'Not entitled — platform-wide "Coming soon" state, not toggleable by any company or override yet.'
                          : (
                            <>
                              Plan default: {f.planDefault ? 'on' : 'off'}
                              {f.isOverridden && <span className="text-primary"> · overridden{f.overrideReason ? `: ${f.overrideReason}` : ''}</span>}
                            </>
                          )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Toggle checked={f.comingSoon ? false : f.effective} onChange={() => toggleFeature(f)} disabled={busy || f.comingSoon} />
                      {f.isOverridden && !f.comingSoon && (
                        <Button size="sm" variant="ghost" onClick={() => resetFeature(f)}>Reset</Button>
                      )}
                    </div>
                  </div>
                  {!f.comingSoon && (
                    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-xs text-fg-subtle">
                        Data collection: <span className={f.dataCollectionMode === 'stop' ? 'text-danger font-medium' : 'text-fg font-medium'}>{f.dataCollectionMode}</span>
                        {' '}(independent of visibility above)
                      </span>
                      {f.dataCollectionMode === 'stop' ? (
                        <Button size="sm" variant="outline" loading={busy} onClick={() => setDataMode(f, 'continue', 'Resumed by super-admin', true)}>
                          Resume collection
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setDataModeTarget(f)}>
                          Stop collection
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Seat limit override" subtitle="Grant extra seats without a full plan change" />
        <div className="px-5 pb-5 flex items-end gap-3">
          <Input label="Extra seats (max_seats_override)" type="number" min="0" placeholder="e.g. 5" value={seatValue} onChange={(e) => setSeatValue(e.target.value)} />
          <Button loading={busy} onClick={submitSeatOverride}>Apply</Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Data export override"
          subtitle="Anti-abuse rule: bulk data export is blocked whenever this company's subscription status isn't active/trialing (past_due, grace_period, suspended, cancelled, expired). This override is the ONLY way around that — a manual credit or a subscription extension never unlocks export on their own."
          action={<Badge tone={exportOverrideEnabled ? 'warning' : 'neutral'}>{exportOverrideEnabled ? 'Override active' : 'Not overridden'}</Badge>}
        />
        <div className="px-5 pb-5">
          {exportOverrideEnabled ? (
            <Button size="sm" variant="outline" loading={busy} onClick={() => submitExportOverride(false)}>
              Disable override
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setExportOverrideOpen(true)}
              title="Let this company export their data despite a non-active subscription status — a genuine goodwill exception, e.g. a lapsing customer retrieving their own records. Requires a reason and is logged."
            >
              Enable override
            </Button>
          )}
        </div>
      </Card>

      <Modal
        open={exportOverrideOpen}
        onClose={() => setExportOverrideOpen(false)}
        title="Enable data export override"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExportOverrideOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={() => submitExportOverride(true)}>Enable override</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-subtle">
            Allows this company to bulk-export their data even though their subscription isn't in good standing.
            Use for genuine goodwill cases (e.g. a lapsing customer retrieving their own records) — not a substitute
            for resolving the underlying billing issue.
          </p>
          <Textarea label="Reason" value={exportOverrideReason} onChange={(e) => setExportOverrideReason(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={Boolean(dataModeTarget)}
        onClose={() => { setDataModeTarget(null); setDataModeReason(''); setDataModeConfirmed(false); }}
        title={`Stop data collection: ${dataModeTarget ? (FEATURE_LABELS[dataModeTarget.key] || dataModeTarget.key) : ''}`}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setDataModeTarget(null); setDataModeReason(''); setDataModeConfirmed(false); }}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!dataModeConfirmed || !dataModeReason.trim()}
              onClick={() => setDataMode(dataModeTarget, 'stop', dataModeReason.trim(), true)}
            >
              Stop data collection
            </Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="text-sm text-fg">{STOP_COPY[dataModeTarget?.key] || 'Stopping data collection means new data for this feature will no longer be recorded, even internally. Existing historical data is not affected.'}</p>
          <Textarea
            label="Reason / note (required)"
            placeholder="e.g. confirmed via email with [contact] on [date]"
            value={dataModeReason}
            onChange={(e) => setDataModeReason(e.target.value)}
          />
          <label className="flex items-start gap-2 text-xs text-fg-subtle">
            <input type="checkbox" checked={dataModeConfirmed} onChange={(e) => setDataModeConfirmed(e.target.checked)} className="mt-0.5" />
            I understand this stops data collection for this feature, even internally, until resumed.
          </label>
        </div>
      </Modal>
    </div>
  );
}

function ActivityTab({ companyId }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'audit-log', page],
    queryFn: () => getCompanyAuditLogApi(companyId, { page, limit: 20 }),
    keepPreviousData: true,
  });
  const rows = data?.items || [];
  const meta = data?.meta;

  return (
    <Card>
      <CardHeader title="Activity log" subtitle={meta ? `${meta.total} entries` : ''} />
      <div className="px-5 pb-5">
        {isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : rows.length === 0 ? (
          <p className="text-sm text-fg-subtle py-8 text-center">No activity recorded yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">
                    {r.actionType.replace(/_/g, ' ')}
                    {r.actorType === 'super_admin' && <Badge tone="info" className="ml-2">super admin{r.isImpersonated ? ' · impersonating' : ''}</Badge>}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {r.actor ? `${r.actor.firstName} ${r.actor.lastName}` : r.actorType === 'super_admin' ? 'Platform team' : 'System'} on {r.targetType}
                  </p>
                </div>
                <span className="text-xs text-fg-subtle shrink-0">{formatDateTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
        {meta && meta.totalPages > 1 && (
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-xs text-fg-subtle self-center">Page {page} of {meta.totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function NotesTab({ companyId }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['super-admin', 'company', companyId, 'notes'],
    queryFn: () => listCompanyNotesApi(companyId),
  });

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await addCompanyNoteApi(companyId, note.trim());
      setNote('');
      await qc.invalidateQueries({ queryKey: ['super-admin', 'company', companyId, 'notes'] });
    } catch (err) {
      toast.error(err.message || 'Could not add note');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (noteId) => {
    try {
      await deleteCompanyNoteApi(companyId, noteId);
      await qc.invalidateQueries({ queryKey: ['super-admin', 'company', companyId, 'notes'] });
    } catch (err) {
      toast.error(err.message || 'Could not delete note');
    }
  };

  return (
    <Card>
      <CardHeader title="Internal notes" subtitle="Support/ops only — never visible to this company's users" />
      <div className="px-5 pb-5 space-y-4">
        <div className="flex gap-2">
          <Textarea className="flex-1" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button icon={Plus} loading={busy} onClick={submit}>Add</Button>
        </div>
        {isLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : notes.length === 0 ? (
          <p className="text-sm text-fg-subtle py-4 text-center">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg whitespace-pre-wrap">{n.note}</p>
                  <p className="text-xs text-fg-subtle mt-1">{n.author?.email || 'Unknown'} · {formatDateTime(n.createdAt)}</p>
                </div>
                <button type="button" onClick={() => remove(n.id)} className="text-fg-subtle hover:text-danger shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
