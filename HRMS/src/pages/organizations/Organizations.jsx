import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Building2, Plus, Eye, ShieldCheck, ToggleLeft, ToggleRight,
  ImagePlus, ChevronRight, Pencil, Check, X, MapPin, Landmark, FileText, BadgeCheck,
  AlertTriangle, Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, Button, Input, Select, Badge, EmptyState, Skeleton,
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
import {
  mergeLegalProfile, formatRegisteredAddress, SUBSIDIARY_REQUIRED_KEYS,
  subsidiaryDetailErrors, missingDetailLabels, stateOptions,
} from '../../lib/companyLegal';
import { CompanyLegalFields } from '../../components/shared/CompanyLegalFields';
import { useAuthStore } from '../../store/authStore';
import { useCan } from '../../hooks/useCan';
import { useCompanyStore } from '../../store/companyStore';
import { PortalLinks } from '../../components/shared/PortalLinks';

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
  const iconUrl = company?.brandIconUrl || null;
  const sizeClass = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';

  if (iconUrl) {
    return (
      <div className={cn(sizeClass, 'shrink-0 rounded-xl border border-border/60 bg-card p-1 overflow-hidden')}>
        <img
          src={iconUrl}
          alt={company?.name || 'Company'}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <Avatar
      name={company?.name}
      size={size}
      className="rounded-xl"
    />
  );
}

const WEBSITE_HINT = 'The company\'s domain, like acme.in. Its employees\' work email addresses are generated from it (name.surname@acme.in).';

/** The details form, filled from a company's saved profile. */
const detailsFormFrom = (p = {}) => ({
  ...mergeLegalProfile(p),
  addressLine1: p.addressLine1 || '',
  addressLine2: p.addressLine2 || '',
  city: p.city || '',
  state: p.state || '',
  pincode: p.pincode || '',
  country: p.country || 'India',
  website: p.website || '',
  contactName: p.contactName || '',
  contactEmail: p.contactEmail || '',
  contactPhone: p.contactPhone || '',
});

/**
 * Registered address. `required` (a subsidiary) marks the required fields,
 * picks the state from the Indian list and keeps the PIN to 6 digits; the
 * primary company's fields stay free text.
 */
function AddressFields({ form, setForm, required = false, errors = {}, withCountry = false }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Input label="Address line 1" required={required} error={errors.addressLine1} containerClass="sm:col-span-2" value={form.addressLine1 || ''} onChange={set('addressLine1')} />
      <Input label="Address line 2" containerClass="sm:col-span-2" value={form.addressLine2 || ''} onChange={set('addressLine2')} />
      <Input label="City" required={required} error={errors.city} value={form.city || ''} onChange={set('city')} />
      {required ? (
        <Select label="State" required error={errors.state} placeholder="Select state" options={stateOptions(form.state)} value={form.state || ''} onChange={set('state')} />
      ) : (
        <Input label="State" value={form.state || ''} onChange={set('state')} />
      )}
      <Input
        label="PIN code"
        required={required}
        error={errors.pincode}
        {...(required ? { inputMode: 'numeric', maxLength: 6, placeholder: '6 digits' } : {})}
        value={form.pincode || ''}
        onChange={(e) => setForm((f) => ({ ...f, pincode: required ? e.target.value.replace(/\D/g, '') : e.target.value }))}
      />
      {withCountry && <Input label="Country" value={form.country || ''} onChange={set('country')} />}
    </div>
  );
}

/** Website and contact email (required for a subsidiary); `withOptional` adds contact name and phone. */
function ContactFields({ form, setForm, required = false, errors = {}, withOptional = false }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Input label="Website" required={required} error={errors.website} placeholder="e.g. acme.in" hint={WEBSITE_HINT} containerClass="sm:col-span-2" value={form.website || ''} onChange={set('website')} />
      <Input label="Contact email" type="email" required={required} error={errors.contactEmail} placeholder="e.g. hr@acme.in" containerClass={withOptional ? undefined : 'sm:col-span-2'} value={form.contactEmail || ''} onChange={set('contactEmail')} />
      {withOptional && (
        <>
          <Input label="Contact phone" value={form.contactPhone || ''} onChange={set('contactPhone')} />
          <Input label="Contact name" containerClass="sm:col-span-2" value={form.contactName || ''} onChange={set('contactName')} />
        </>
      )}
    </div>
  );
}

/** "Complete the required details: …" for a subsidiary missing some; `onComplete` opens the form. */
function MissingDetailsNotice({ keys, onComplete, className }) {
  return (
    <div className={cn('rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm', className)}>
      <p className="flex items-start gap-2 text-fg">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <span>Complete the required details: {missingDetailLabels(keys).join(', ')}.</span>
      </p>
      {onComplete && (
        // Inside a clickable card: the card mustn't take this click or key press.
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onComplete(); }}
          onKeyDown={(e) => e.stopPropagation()}
          className="mt-1.5 ml-6 text-xs font-medium text-primary hover:underline"
        >
          Complete details
        </button>
      )}
    </div>
  );
}

function CompanyCard({ company, selected, onSelect, onToggle, toggling, onCompleteDetails }) {
  const missing = company.companyType === 'child' ? company.missingDetails || [] : [];
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
      {missing.length > 0 && (
        <MissingDetailsNotice
          className="mt-3"
          keys={missing}
          onComplete={onCompleteDetails ? () => onCompleteDetails(company) : undefined}
        />
      )}
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

function CompanyDetailsDrawer({
  company, open, onClose, canEdit, uploadLogo, updateChild, updateDetails, editOnOpen, onEditOpened,
}) {
  const detailsQ = useCompanyDetails(company?.id, open);
  const updateHomeCompany = useCompanyStore((s) => s.updateCompany);
  const [uploading, setUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [editingLegal, setEditingLegal] = useState(false);
  const [legalForm, setLegalForm] = useState(() => detailsFormFrom({}));
  const [savingLegal, setSavingLegal] = useState(false);
  // Errors show once a save is tried, or straight away for details already missing.
  const [showErrors, setShowErrors] = useState(false);

  const profile = detailsQ.data?.profile || mergeLegalProfile({});
  const canEditName = Boolean(canEdit && company && !company.isHome && company.companyType === 'child');
  // A subsidiary's important details are required; the primary company's aren't.
  const isSub = company?.companyType === 'child';
  const missing = isSub ? (detailsQ.data?.missingDetails ?? company?.missingDetails ?? []) : [];
  const legalErrors = isSub && showErrors ? subsidiaryDetailErrors(legalForm) : {};

  useEffect(() => {
    setEditingName(false);
    setNameDraft('');
    setEditingLegal(false);
    setShowErrors(false);
  }, [company?.id, open]);

  useEffect(() => {
    if (editingLegal) return;
    setLegalForm(detailsFormFrom(detailsQ.data?.profile || {}));
  }, [detailsQ.data, editingLegal]);

  // Opened from a card's "Complete details": straight to the form once the details are in.
  useEffect(() => {
    if (!open || !editOnOpen || !canEdit || !detailsQ.data) return;
    setLegalForm(detailsFormFrom(detailsQ.data.profile || {}));
    setShowErrors(true);
    setEditingLegal(true);
    onEditOpened?.();
  }, [open, editOnOpen, canEdit, detailsQ.data, onEditOpened]);

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
    setLegalForm(detailsFormFrom(profile));
    setShowErrors(missing.length > 0);
    setEditingLegal(true);
  };

  const saveLegal = async () => {
    if (!company?.id) return;
    if (isSub && Object.keys(subsidiaryDetailErrors(legalForm)).length) {
      setShowErrors(true);
      toast.error('Fill in the required details marked *');
      return;
    }
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
        setShowErrors(false);
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
                  <button type="button" aria-label="Save name" disabled={savingName} onClick={saveName} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary hover:bg-primary-dark disabled:opacity-50">
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
              {isSub && (
                <p className="text-xs text-fg-muted">
                  Fields marked <span className="text-danger">*</span> are required for a subsidiary.
                </p>
              )}
              <div>
                <p className="text-sm font-semibold text-fg mb-3">Registered address</p>
                <AddressFields form={legalForm} setForm={setLegalForm} required={isSub} errors={legalErrors} withCountry />
              </div>
              <div>
                <p className="text-sm font-semibold text-fg mb-3">Contact and website</p>
                <ContactFields form={legalForm} setForm={setLegalForm} required={isSub} errors={legalErrors} withOptional />
              </div>
              <CompanyLegalFields
                form={legalForm}
                setForm={setLegalForm}
                requiredKeys={isSub ? SUBSIDIARY_REQUIRED_KEYS : []}
                errors={legalErrors}
              />
            </div>
          )}

          {!detailsQ.isLoading && !detailsQ.isError && !editingLegal && (
            <div className="space-y-5">
              {missing.length > 0 && (
                <MissingDetailsNotice keys={missing} onComplete={canEdit ? startEditLegal : undefined} />
              )}

              <section>
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Registered address
                </h3>
                <DetailRow label="Address" value={address} />
              </section>

              <section>
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Contact and website
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <DetailRow label="Website" value={profile.website} />
                  <DetailRow label="Contact email" value={profile.contactEmail} />
                  <DetailRow label="Contact name" value={profile.contactName} />
                  <DetailRow label="Contact phone" value={profile.contactPhone} />
                </div>
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
  companies, loading, onToggle, toggling, selected, onSelect, stats, onCompleteDetails,
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
            onCompleteDetails={onCompleteDetails}
          />
        ))}
      </div>
    </div>
  );
}

const EMPTY_SUBSIDIARY_DETAILS = {
  legalName: '', pan: '', addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', website: '', contactEmail: '',
};

function AddTab({ canManage, blockedMessage, createChild, uploadLogo, onCreated }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [details, setDetails] = useState(EMPTY_SUBSIDIARY_DETAILS);
  const [showErrors, setShowErrors] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [logoKey, setLogoKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [createdCompany, setCreatedCompany] = useState(null);
  const errors = showErrors ? subsidiaryDetailErrors(details) : {};
  const nameError = showErrors && name.trim().length < 2 ? 'Enter at least 2 characters' : undefined;

  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Cannot add companies"
        message={blockedMessage}
      />
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setShowErrors(true);
      toast.error('Enter a company name (at least 2 characters)');
      return;
    }
    if (Object.keys(subsidiaryDetailErrors(details)).length) {
      setShowErrors(true);
      toast.error('Fill in the required details marked *');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), ...details, country: 'India' };
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
      setCreatedCompany(created?.slug ? created : null);
      setName('');
      setSlug('');
      setDetails(EMPTY_SUBSIDIARY_DETAILS);
      setShowErrors(false);
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
        Creates an isolated workspace under your primary company. Fields marked <span className="text-danger">*</span> are
        required. GSTIN, CIN, directors and other details can be added later from the company&apos;s page.
      </p>
      <form onSubmit={submit} noValidate className="space-y-5">
        <Input
          label="Company name"
          required
          error={nameError}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Legal / registered name"
            required
            error={errors.legalName}
            containerClass="sm:col-span-2"
            placeholder="As on MCA / GST certificate"
            value={details.legalName}
            onChange={(e) => setDetails((d) => ({ ...d, legalName: e.target.value }))}
          />
          <Input
            label="PAN"
            required
            error={errors.pan}
            placeholder="e.g. AAAAA0000A"
            maxLength={10}
            value={details.pan}
            onChange={(e) => setDetails((d) => ({ ...d, pan: e.target.value.toUpperCase() }))}
          />
        </div>

        <div>
          <p className="text-sm font-semibold text-fg mb-3">Registered address</p>
          <AddressFields form={details} setForm={setDetails} required errors={errors} />
        </div>

        <div>
          <p className="text-sm font-semibold text-fg mb-3">Contact and website</p>
          <ContactFields form={details} setForm={setDetails} required errors={errors} />
        </div>

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

      {createdCompany && (
        <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <div className="text-sm font-medium text-fg">
            Login links for {createdCompany.name}
          </div>
          <PortalLinks slug={createdCompany.slug} />
        </div>
      )}
    </Card>
  );
}

function AccessTab({ companies, myCompany, loading, canAdd }) {
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
            {!myCompany?.canManageChildren
              ? 'This is a subsidiary — you only manage this workspace.'
              : canAdd
                ? 'You can create subsidiaries and assign employees to them.'
                : 'You can assign employees to companies. Adding subsidiaries needs an Admin\'s permission.'}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const validTab = TABS.some((t) => t.id === tabFromUrl) ? tabFromUrl : 'view';
  const [tab, setTabState] = useState(validTab);
  const setTab = (id) => {
    setTabState(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  };
  const [selected, setSelected] = useState(null);
  // Set by a card's "Complete details": the drawer opens on its form.
  const [editOnOpen, setEditOnOpen] = useState(false);
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
  const isParentCompany = myCompanyQ.data?.canManageChildren !== false
    && myCompanyQ.data?.companyType !== 'child';
  // Admin always; HR as Settings → User & Role Management allows (Organizations).
  const canCreateCompanies = useCan('organizations', 'create');
  const canEditCompanies = useCan('organizations', 'edit');
  const canAdd = canCreateCompanies && isParentCompany;
  // Switching a subsidiary on or off stays with Admin.
  const canManage = isAdmin && isParentCompany;
  const canEditLegal = ['admin', 'hr'].includes(String(role || '').toLowerCase()) && canEditCompanies;
  const addBlockedMessage = isParentCompany
    ? 'Your role can\'t add companies. An Admin can allow it in Settings → User & Role Management (Organizations → Create).'
    : 'Subsidiary admins cannot create further subsidiaries. Ask your primary company admin.';

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
          onCompleteDetails={canEditLegal ? (company) => { setSelected(company); setEditOnOpen(true); } : undefined}
        />
      )}
      {tab === 'add' && (
        <AddTab
          canManage={canAdd}
          blockedMessage={addBlockedMessage}
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
          canAdd={canAdd}
        />
      )}

      <CompanyDetailsDrawer
        company={selectedLive}
        open={Boolean(selectedLive)}
        onClose={() => { setSelected(null); setEditOnOpen(false); }}
        canEdit={canEditLegal}
        uploadLogo={uploadLogo}
        updateChild={updateChild}
        updateDetails={updateDetails}
        editOnOpen={editOnOpen}
        onEditOpened={() => setEditOnOpen(false)}
      />
    </div>
  );
}
