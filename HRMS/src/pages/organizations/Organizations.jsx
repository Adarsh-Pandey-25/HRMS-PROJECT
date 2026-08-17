import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Plus, Eye, ShieldCheck, Users, ToggleLeft, ToggleRight,
  ImagePlus, ChevronRight, Mail, Briefcase, ArrowRightLeft, Pencil, Check, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, Button, Input, Badge, EmptyState, Skeleton,
  Avatar, Drawer, FileUpload, StatCard,
} from '../../components/ui';
import {
  useMyCompany,
  useAccessibleCompanies,
  useCompanyEmployees,
  useCompanyMutations,
  companyKeys,
} from '../../hooks/useCompanies';
import { useEmployees } from '../../hooks/useEmployees';
import { ChangeCompanyModal } from '../../components/shared/ChangeCompanyModal';
import { cn, formatDate } from '../../lib/utils';
import { filterDirectoryEmployees, employeeProfilePath } from '../../lib/employeeRoutes';
import { useQueryClient } from '@tanstack/react-query';
import { companyTypeLabel } from '../../lib/companyLabels';

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
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {company.employeeCount ?? 0} employee{(company.employeeCount ?? 0) === 1 ? '' : 's'}
            </span>
            <span className="text-xs text-fg-subtle">
              {company.createdAt ? formatDate(company.createdAt) : ''}
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

function EmployeesDrawer({ company, open, onClose, canManage, uploadLogo, updateChild }) {
  const employeesQ = useCompanyEmployees(company?.id, open);
  const { employees: allEmployees } = useEmployees();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [changeEmp, setChangeEmp] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const canEditName = Boolean(canManage && company && !company.isHome && company.companyType === 'child');

  useEffect(() => {
    setEditingName(false);
    setNameDraft('');
  }, [company?.id, open]);

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
      // Always PATCH so slug stays in sync even if display name is unchanged
      await updateChild.mutateAsync({ id: company.id, name: trimmed });
      toast.success('Company name updated');
      setEditingName(false);
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
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

  const employees = useMemo(() => {
    const fromApi = employeesQ.data;
    if (Array.isArray(fromApi) && fromApi.length > 0) return fromApi;
    if (employeesQ.isLoading) return [];
    const cid = String(company?.id || '');
    if (!cid) return [];
    return filterDirectoryEmployees(allEmployees || [])
      .filter((e) => String(e.companyId || e.company_id || '') === cid)
      .map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        name: e.name,
        email: e.workEmail || e.email,
        department: e.department,
        designation: e.designation,
        role: e.role,
        isActive: e.status !== 'resigned' && e.isActive !== false,
        companyId: e.companyId || e.company_id,
        companyName: e.companyName || company?.name,
      }));
  }, [employeesQ.data, employeesQ.isLoading, allEmployees, company?.id, company?.name]);

  const shownCount = employees.length || company?.employeeCount || 0;

  const refreshAfterMove = () => {
    qc.invalidateQueries({ queryKey: ['companies'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    if (company?.id) {
      qc.invalidateQueries({ queryKey: companyKeys.employees(company.id) });
    }
  };

  return (
    <>
    <Drawer
      open={open}
      onClose={() => {
        cancelEditName();
        onClose();
      }}
      width="w-[480px]"
      title={company?.name || 'Company'}
      subtitle={
        company
          ? `${company.companyType === 'child' ? 'Subsidiary' : 'Company'} · ${shownCount} employee${shownCount === 1 ? '' : 's'}`
          : undefined
      }
      footer={
        company && (
          <Link
            to={`/employees?company=${company.id}`}
            className="inline-flex w-full items-center justify-center rounded-input font-medium h-10 px-4 text-sm gap-2 border border-border bg-card text-fg hover:bg-muted"
          >
            Open Employees module
          </Link>
        )
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
                  <button
                    type="button"
                    aria-label="Save name"
                    disabled={savingName}
                    onClick={saveName}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel"
                    disabled={savingName}
                    onClick={cancelEditName}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-muted"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-base font-semibold text-fg truncate">{company.name}</p>
                  {canEditName && (
                    <button
                      type="button"
                      onClick={startEditName}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit name
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {typeBadge(company.companyType)}
                {company.isActive
                  ? <Badge tone="success">Active</Badge>
                  : <Badge tone="danger">Inactive</Badge>}
              </div>

              {canManage && (
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

          <div>
            <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Employees
            </h3>

            {employeesQ.isLoading && employees.length === 0 && (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            )}

            {employeesQ.isError && employees.length === 0 && (
              <EmptyState
                icon={Users}
                title="Could not load employees"
                message={employeesQ.error?.message || 'Try again, or open the Employees module.'}
              />
            )}

            {!employeesQ.isLoading && !employeesQ.isError && employees.length === 0 && (
              <EmptyState
                icon={Users}
                title="No employees yet"
                message="Assign staff to this company from Employees → Add / Edit Employee."
              />
            )}

            {employees.length > 0 && (
              <ul className="space-y-2">
                {employees.map((emp) => (
                  <li
                    key={emp.id}
                    className="rounded-lg border border-border px-3 py-2.5 flex items-start gap-3"
                  >
                    <Avatar name={emp.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={employeeProfilePath(emp, allEmployees)}
                          className="font-medium text-fg hover:text-primary truncate"
                        >
                          {emp.name}
                        </Link>
                        {emp.isActive === false && <Badge tone="danger">Inactive</Badge>}
                      </div>
                      <div className="text-xs text-fg-subtle mt-0.5">
                        {emp.employeeCode || '—'}
                        {emp.role ? ` · ${emp.role}` : ''}
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-xs text-fg-muted">
                        {emp.email && (
                          <div className="flex items-center gap-1.5 truncate">
                            <Mail className="w-3 h-3 shrink-0" />
                            {emp.email}
                          </div>
                        )}
                        {(emp.department || emp.designation) && (
                          <div className="flex items-center gap-1.5 truncate">
                            <Briefcase className="w-3 h-3 shrink-0" />
                            {[emp.designation, emp.department].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setChangeEmp({
                            ...emp,
                            companyId: emp.companyId || company.id,
                            companyName: company.name,
                          })}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                          Change company
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>

    <ChangeCompanyModal
      open={Boolean(changeEmp)}
      employee={changeEmp}
      onClose={() => setChangeEmp(null)}
      onSuccess={refreshAfterMove}
    />
    </>
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
        <StatCard label="Employees (all)" value={stats.employees} icon={Users} />
      </div>

      <p className="text-sm text-fg-muted">
        Click a company to view its employees and manage the logo.
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
        Creates an isolated workspace under your main company. Assign employees from
        Employees → Add Employee, and they will appear here under that company.
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
          As Admin you manage the companies below. When adding an employee, pick which company
          they belong to from this list.
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
        <h3 className="text-base font-semibold text-fg mb-4">Companies you can assign employees to</h3>
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
                      {' · '}
                      {c.employeeCount ?? 0} employees
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {typeBadge(c.companyType)}
                  <Badge tone="success">Assignable</Badge>
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
  const myCompanyQ = useMyCompany(true);
  const accessibleQ = useAccessibleCompanies(true);
  const { createChild, updateChild, uploadLogo } = useCompanyMutations();

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
    employees: companies.reduce((sum, c) => sum + (c.employeeCount || 0), 0),
  }), [companies]);

  const canManage = myCompanyQ.data?.canManageChildren !== false
    && myCompanyQ.data?.companyType !== 'child';

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
        subtitle="Manage your main company, subsidiaries, logos, and employees. Admin only."
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

      <EmployeesDrawer
        company={selectedLive}
        open={Boolean(selectedLive)}
        onClose={() => setSelected(null)}
        canManage={canManage || selectedLive?.isHome}
        uploadLogo={uploadLogo}
        updateChild={updateChild}
      />
    </div>
  );
}
