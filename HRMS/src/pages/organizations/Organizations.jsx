import { useMemo, useState, useEffect } from 'react';
import {
  Building2, Plus, Eye, ShieldCheck, ToggleLeft, ToggleRight,
  ImagePlus, ChevronRight, Pencil, Check, X, MapPin, Landmark, FileText, BadgeCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, Button, Input, Badge, EmptyState, Skeleton,
  Avatar, Drawer, FileUpload, StatCard,
} from '../../components/ui';
import {
  useMyCompany,
  useAccessibleCompanies,
  useCompanyDetails,
  useCompanyMutations,
} from '../../hooks/useCompanies';
import { cn, formatDate } from '../../lib/utils';
import { companyTypeLabel } from '../../lib/companyLabels';
import { mergeLegalProfile, formatRegisteredAddress } from '../../lib/companyLegal';
import { CompanyLegalFields } from '../../components/shared/CompanyLegalFields';
import { useAuthStore } from '../../store/authStore';
import { useCompanyStore } from '../../store/companyStore';

const TABS = [
  { id: 'view', label: 'View companies', icon: Eye },
  { id: 'add', label: 'Add subsidiary', icon: Plus },
  { id: 'access', label: 'Company access', icon: ShieldCheck },
];

function typeBadge(type) {
  if (type === 'parent') return <Badge tone="primary">{companyTypeLabel('parent')}</Badge>;
  if (type === 'child') return <Badge tone="teal">{companyTypeLabel('child')}</Badge>;
  return <Badge tone="neutral">{companyTypeLabel(type) || 'Standalone'}</Badge>;
}

function CompanyLogo({ company, size = 'md' }) {
  return (
    <Avatar
      name={company?.name}
      src={company?.logoUrl || undefined}
      size={size}
      className={cn(!company?.logoUrl && 'rounded-xl')}
    />
  );
}

function CompanyCard({ company, selected, onSelect, onToggle, toggling }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(company)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(company);
        }
      }}
      className={cn(
        'text-left w-full rounded-xl border bg-card p-4 transition-all cursor-pointer',
        'hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected ? 'border-primary ring-1 ring-primary/30' : 'border-border',
        company.isActive === false && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-3">
        <CompanyLogo company={company} size="md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-fg truncate">{company.name}</div>
            <ChevronRight className="w-4 h-4 text-fg-subtle shrink-0" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {typeBadge(company.companyType)}
            {company.isActive
              ? <Badge tone="success">Active</Badge>
              : <Badge tone="danger">Inactive</Badge>}
            {company.isHome && <Badge tone="neutral">Your company</Badge>}
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              {[company.city, company.state].filter(Boolean).join(', ') || 'Address not set'}
            </span>
            <span className="text-xs text-fg-subtle shrink-0">
              {company.gstin || (company.createdAt ? formatDate(company.createdAt) : '')}
            </span>
          </div>
        </div>
      </div>
      {!company.isHome && company.companyType === 'child' && onToggle && (
        <div className="mt-3 pt-3 border-t border-border/60" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={toggling}
            onClick={() => onToggle(company)}
          >
            {company.isActive ? (
              <><ToggleRight className="w-4 h-4" /> Deactivate</>
            ) : (
              <><ToggleLeft className="w-4 h-4" /> Activate</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  const text = String(value || '').trim();
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={cn('text-sm mt-0.5 whitespace-pre-line', text ? 'text-fg' : 'text-fg-subtle')}>
        {text || 'Not provided'}
      </p>
    </div>
  );
}

function PeopleList({ people, empty, extra }) {
  if (!people?.length) {
    return <p className="text-sm text-fg-subtle">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {people.map((p) => (
        <li key={p.id || p.name} className="rounded-lg border border-border px-3 py-2">
          <p className="text-sm font-medium text-fg">{p.name}</p>
          <p className="text-xs text-fg-muted mt-0.5">{extra(p)}</p>
        </li>
      ))}
    </ul>
  );
}

function CompanyDetailsDrawer({ company, open, onClose, canEdit, uploadLogo, updateChild, updateDetails }) {
  const detailsQ = useCompanyDetails(company?.id, open);
  const updateHomeCompany = useCompanyStore((s) => s.updateCompany);
  const [uploading, setUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [editingLegal, setEditingLegal] = useState(false);
  const [legalForm, setLegalForm] = useState(() => mergeLegalProfile({}));
  const [savingLegal, setSavingLegal] = useState(false);

  const profile = detailsQ.data?.profile || mergeLegalProfile({});
  const canEditName = Boolean(canEdit && company && !company.isHome && company.companyType === 'child');

  useEffect(() => {
    setEditingName(false);
    setNameDraft('');
    setEditingLegal(false);
  }, [company?.id, open]);

  useEffect(() => {
    if (editingLegal) return;
    setLegalForm({
      ...mergeLegalProfile(detailsQ.data?.profile || {}),
      addressLine1: detailsQ.data?.profile?.addressLine1 || '',
      addressLine2: detailsQ.data?.profile?.addressLine2 || '',
      city: detailsQ.data?.profile?.city || '',
      state: detailsQ.data?.profile?.state || '',
      pincode: detailsQ.data?.profile?.pincode || '',
      country: detailsQ.data?.profile?.country || 'India',
    });
  }, [detailsQ.data, editingLegal]);

  const startEditName = () => {
    setNameDraft(company?.name || '');
    setEditingName(true);
  };

  const cancelEditName = () => {
    setEditingName(false);
    setNameDraft('');
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (trimmed.length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (!company?.id) {
      cancelEditName();
      return;
    }
    setSavingName(true);
    try {
      await updateChild.mutateAsync({ id: company.id, name: trimmed });
      toast.success('Company name updated');
      setEditingName(false);
    } catch (err) {
      toast.error(err.message || 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  };

  const onLogoPick = async (files) => {
    const file = files?.[0];
    if (!file || !company?.id) return;
    setUploading(true);
    try {
      await uploadLogo.mutateAsync({ id: company.id, file });
      toast.success('Logo updated');
    } catch (err) {
      toast.error(err.message || 'Logo upload failed');
    } finally {
      setUploading(false);
    }
  };

  const startEditLegal = () => {
    setLegalForm({
      ...mergeLegalProfile(profile),
      addressLine1: profile.addressLine1 || '',
      addressLine2: profile.addressLine2 || '',
      city: profile.city || '',
      state: profile.state || '',
      pincode: profile.pincode || '',
      country: profile.country || 'India',
    });
    setEditingLegal(true);
  };

  const saveLegal = async () => {
    if (!company?.id) return;
    setSavingLegal(true);
    try {
      const saved = await updateDetails.mutateAsync({
        id: company.id,
        ...legalForm,
      });
      if (company.isHome && saved?.profile) {
        updateHomeCompany(saved.profile);
      }
      toast.success('Company details saved');
      setEditingLegal(false);
    } catch (err) {
      toast.error(err.message || 'Could not save details');
    } finally {
      setSavingLegal(false);
    }
  };

  const address = formatRegisteredAddress(profile);

  return (
    <Drawer
      open={open}
      onClose={() => {
        cancelEditName();
        setEditingLegal(false);
        onClose();
      }}
      width="w-[520px]"
      title={company?.name || 'Company'}
      subtitle={company ? `${company.companyType === 'child' ? 'Subsidiary' : 'Company'} details` : undefined}
      footer={
        canEdit && company ? (
          editingLegal ? (
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingLegal(false)} disabled={savingLegal}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={saveLegal} loading={savingLegal} disabled={savingLegal}>
                Save details
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={startEditLegal}>
              <Pencil className="w-4 h-4" />
              Edit company details
            </Button>
          )
        ) : null
      }
    >
      {!company ? null : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <CompanyLogo company={company} size="lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEditName(); }
                    }}
                    disabled={savingName}
                    className="h-8 min-w-0 flex-1 rounded-md border border-primary bg-card px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Company name"
                  />
                  <button type="button" aria-label="Save name" disabled={savingName} onClick={saveName} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-white hover:bg-primary-dark disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label="Cancel" disabled={savingName} onClick={cancelEditName} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-muted">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-base font-semibold text-fg truncate">{company.name}</p>
                  {canEditName && (
                    <button type="button" onClick={startEditName} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0">
                      <Pencil className="w-3 h-3" />
                      Edit name
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {typeBadge(company.companyType)}
                {company.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>}
              </div>

              {canEdit && (
                <label className="inline-flex items-center gap-1.5 text-xs text-primary cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5" />
                  {uploading ? 'Uploading…' : 'Change logo'}
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onLogoPick([f]);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          {detailsQ.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {detailsQ.isError && (
            <EmptyState
              icon={Building2}
              title="Could not load company details"
              message={detailsQ.error?.message || 'Try again in a moment.'}
            />
          )}

          {!detailsQ.isLoading && !detailsQ.isError && editingLegal && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-fg mb-3">Registered address</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Address line 1" containerClass="sm:col-span-2" value={legalForm.addressLine1 || ''} onChange={(e) => setLegalForm((f) => ({ ...f, addressLine1: e.target.value }))} />
                  <Input label="Address line 2" containerClass="sm:col-span-2" value={legalForm.addressLine2 || ''} onChange={(e) => setLegalForm((f) => ({ ...f, addressLine2: e.target.value }))} />
                  <Input label="City" value={legalForm.city || ''} onChange={(e) => setLegalForm((f) => ({ ...f, city: e.target.value }))} />
                  <Input label="State" value={legalForm.state || ''} onChange={(e) => setLegalForm((f) => ({ ...f, state: e.target.value }))} />
                  <Input label="PIN code" value={legalForm.pincode || ''} onChange={(e) => setLegalForm((f) => ({ ...f, pincode: e.target.value }))} />
                  <Input label="Country" value={legalForm.country || ''} onChange={(e) => setLegalForm((f) => ({ ...f, country: e.target.value }))} />
                </div>
              </div>
              <CompanyLegalFields form={legalForm} setForm={setLegalForm} />
            </div>
          )}

          {!detailsQ.isLoading && !detailsQ.isError && !editingLegal && (
            <div className="space-y-5">
              <section>
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Registered address
                </h3>
                <DetailRow label="Address" value={address} />
              </section>

              <section>
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4" />
                  Statutory IDs
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DetailRow label="Legal name" value={profile.legalName} />
                  <DetailRow label="GSTIN" value={profile.gstin} />
                  <DetailRow label="PAN" value={profile.pan} />
                  <DetailRow label="CIN" value={profile.cin} />
                  <DetailRow label="TAN" value={profile.tan} />
                  <DetailRow label="Incorporation" value={profile.incorporationDate} />
                </div>
                <div className="mt-3">
                  <DetailRow label="Nature of business" value={profile.natureOfBusiness} />
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <Landmark className="w-4 h-4" />
                  Directors
                </h3>
                <PeopleList
                  people={profile.directors}
                  empty="No directors added yet."
                  extra={(p) => [p.designation, p.din && `DIN ${p.din}`].filter(Boolean).join(' · ') || 'Director'}
                />
              </section>

              <section>
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Founders
                </h3>
                <PeopleList
                  people={profile.founders}
                  empty="No founders added yet."
                  extra={(p) => p.role || 'Founder'}
                />
              </section>

              {canEdit && (
                <p className="text-xs text-fg-subtle">
                  You can also maintain these fields in Settings → Company Profile → Legal & CDD.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ViewTab({
  companies, loading, onToggle, toggling, selected, onSelect, stats,
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!companies.length) {
    return (
      <EmptyState
        icon={Building2}
        title="No companies yet"
        message="Your company will appear here. Add a subsidiary from the Add subsidiary tab."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Companies" value={stats.total} icon={Building2} />
        <StatCard label="Subsidiaries" value={stats.children} icon={Building2} />
        <StatCard label="Active" value={stats.active} icon={ShieldCheck} />
      </div>

      <p className="text-sm text-fg-muted">
        Click a company to view address, GSTIN, directors, and other CDD details.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {companies.map((c) => (
          <CompanyCard
            key={c.id}
            company={c}
            selected={selected?.id === c.id}
            onSelect={onSelect}
            onToggle={onToggle}
            toggling={toggling}
          />
        ))}
      </div>
    </div>
  );
}

function AddTab({ canManage, createChild, uploadLogo, onCreated }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoKey, setLogoKey] = useState(0);
  const [saving, setSaving] = useState(false);

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Cannot add companies"
        message="Subsidiary admins cannot create further subsidiaries. Ask your main company admin."
      />
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error('Enter a company name (at least 2 characters)');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim() };
      if (slug.trim()) payload.slug = slug.trim();
      const created = await createChild.mutateAsync(payload);

      if (logoFile && created?.id) {
        try {
          await uploadLogo.mutateAsync({ id: created.id, file: logoFile });
        } catch (logoErr) {
          toast.error(logoErr.message || 'Company created, but logo upload failed');
        }
      }

      toast.success(`${created?.name || name} added as a subsidiary`);
      setName('');
      setSlug('');
      setLogoFile(null);
      setLogoKey((k) => k + 1);
      onCreated?.(created);
    } catch (err) {
      toast.error(err.message || 'Failed to create company');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 max-w-xl">
      <h3 className="text-base font-semibold text-fg mb-1">Add subsidiary</h3>
      <p className="text-sm text-fg-muted mb-6">
        Creates an isolated workspace under your main company. Open it afterwards to add registered address, GSTIN, directors, and other CDD details.
      </p>
      <form onSubmit={submit} className="space-y-5">
        <Input
          label="Company name"
          required
          placeholder="e.g. North Branch Pvt Ltd"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Slug (optional)"
          placeholder="auto-generated from name"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          hint="URL-safe id; leave blank to auto-generate"
        />

        <div>
          <div className="text-sm font-medium text-fg mb-1.5">Company logo (optional)</div>
          <FileUpload
            key={logoKey}
            accept=".png,.jpg,.jpeg"
            multiple={false}
            maxSizeMB={2}
            hint="PNG or JPG · up to 2MB"
            onChange={(files) => setLogoFile(files?.[0] || null)}
          />
        </div>

        <Button type="submit" disabled={saving}>
          <Plus className="w-4 h-4" />
          {saving ? 'Creating…' : 'Create subsidiary'}
        </Button>
      </form>
    </Card>
  );
}

function AccessTab({ companies, myCompany, loading }) {
  if (loading) {
    return (
      <Card className="p-6 space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }

  const assignable = (companies || []).filter((c) => c.isActive !== false);

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="text-base font-semibold text-fg mb-1">Your company access</h3>
        <p className="text-sm text-fg-muted mb-4">
          As Admin or HR you can open each company to review and update its legal details. Subsidiary workspaces stay isolated.
        </p>
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
          <div className="flex items-center gap-3">
            <CompanyLogo company={myCompany} size="md" />
            <div className="text-sm">
              <span className="text-fg-subtle">Home company:</span>{' '}
              <span className="font-medium text-fg">{myCompany?.name || '—'}</span>
              {myCompany && <span className="ml-2">{typeBadge(myCompany.companyType)}</span>}
            </div>
          </div>
          <div className="text-sm text-fg-muted">
            {myCompany?.canManageChildren
              ? 'You can create subsidiaries and assign employees to them.'
              : 'This is a subsidiary — you only manage this workspace.'}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold text-fg mb-4">Companies in your organization</h3>
        {assignable.length === 0 ? (
          <p className="text-sm text-fg-subtle">No active companies in your access scope.</p>
        ) : (
          <ul className="space-y-2">
            {assignable.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <CompanyLogo company={c} size="sm" />
                  <div className="min-w-0">
                    <div className="font-medium text-fg truncate">{c.name}</div>
                    <div className="text-xs text-fg-subtle">
                      {c.isHome ? 'Your company' : 'Subsidiary'}
                      {c.gstin ? ` · GSTIN ${c.gstin}` : c.city ? ` · ${c.city}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {typeBadge(c.companyType)}
                  {c.isActive !== false ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Inactive</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function Organizations() {
  const [tab, setTab] = useState('view');
  const [selected, setSelected] = useState(null);
  const role = useAuthStore((s) => s.role);
  const myCompanyQ = useMyCompany(true);
  const accessibleQ = useAccessibleCompanies(true);
  const { createChild, updateChild, uploadLogo, updateDetails } = useCompanyMutations();

  const companies = useMemo(() => {
    const list = accessibleQ.data || [];
    return [...list].sort((a, b) => {
      if (a.isHome && !b.isHome) return -1;
      if (!a.isHome && b.isHome) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [accessibleQ.data]);

  // Keep selected company in sync after logo / toggle refreshes
  const selectedLive = useMemo(() => {
    if (!selected?.id) return null;
    return companies.find((c) => c.id === selected.id) || selected;
  }, [companies, selected]);

  const stats = useMemo(() => ({
    total: companies.length,
    children: companies.filter((c) => c.companyType === 'child').length,
    active: companies.filter((c) => c.isActive !== false).length,
  }), [companies]);

  const isAdmin = String(role || '').toLowerCase() === 'admin';
  const canManage = isAdmin
    && myCompanyQ.data?.canManageChildren !== false
    && myCompanyQ.data?.companyType !== 'child';
  const canEditLegal = ['admin', 'hr'].includes(String(role || '').toLowerCase());

  const onToggle = async (company) => {
    try {
      await updateChild.mutateAsync({
        id: company.id,
        is_active: !company.isActive,
      });
      toast.success(company.isActive ? 'Company deactivated' : 'Company activated');
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Organizations"
        subtitle="Company records, GSTIN, directors, and subsidiaries. Admin and HR can update details."
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 text-sm rounded-t-md border-b-2 -mb-px transition-colors',
              tab === id
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'view' && (
        <ViewTab
          companies={companies}
          loading={accessibleQ.isLoading || myCompanyQ.isLoading}
          onToggle={canManage ? onToggle : undefined}
          toggling={updateChild.isPending}
          selected={selectedLive}
          onSelect={setSelected}
          stats={stats}
        />
      )}
      {tab === 'add' && (
        <AddTab
          canManage={canManage}
          createChild={createChild}
          uploadLogo={uploadLogo}
          onCreated={(created) => {
            setTab('view');
            if (created) setSelected(created);
          }}
        />
      )}
      {tab === 'access' && (
        <AccessTab
          companies={companies}
          myCompany={myCompanyQ.data}
          loading={accessibleQ.isLoading || myCompanyQ.isLoading}
        />
      )}

      <CompanyDetailsDrawer
        company={selectedLive}
        open={Boolean(selectedLive)}
        onClose={() => setSelected(null)}
        canEdit={canEditLegal}
        uploadLogo={uploadLogo}
        updateChild={updateChild}
        updateDetails={updateDetails}
      />
    </div>
  );
}
