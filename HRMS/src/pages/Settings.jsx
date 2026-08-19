import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, FileText, Clock, CalendarOff, DollarSign, Bell, Briefcase, Megaphone,
  Monitor, Receipt, GraduationCap, LifeBuoy, Plug, ShieldCheck, Database, Lock, Save, ChevronsLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, CardHeader, Button, Input, Select, Badge, StatusBadge, Avatar, DataTable, FileUpload } from '../components/ui';
import { useCompanyStore } from '../store/companyStore';
import { updateSettingApi, uploadCompanyLogoApi } from '../api/settings.api';
import { useEmployees } from '../hooks/useEmployees';
import { useSettingsStore } from '../store/settingsStore';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { useCan } from '../hooks/useCan';
import { INDUSTRIES, COMPANY_SIZES } from '../lib/constants';
import { PERMISSION_MODULES, PERMISSION_ACTIONS, MODULE_LABELS, ROLES as RBAC_ROLES, isPrivilegedRole } from '../lib/permissions';
import { cn, humanize } from '../lib/utils';
import { invalidateAndRefetch } from '../lib/queryCache';
import { CompanyLegalFields } from '../components/shared/CompanyLegalFields';
import { mergeLegalProfile } from '../lib/companyLegal';
import { DocumentConfigSection } from './settings/DocumentConfigSection';
import { AttendanceConfigSection } from './settings/AttendanceConfigSection';
import { LeavePolicySection } from './settings/LeavePolicySection';
import { PayrollSettingsSection } from './settings/PayrollSettingsSection';
import { NotificationsSection } from './settings/NotificationsSection';
import {
  RecruitmentSettingsSection, AnnouncementSettingsSection, AssetSettingsSection,
  ExpenseSettingsSection, TrainingSettingsSection, HelpdeskSettingsSection,
  IntegrationsSection, SecuritySection, DataBackupSection,
} from './settings/GenericSections';

const SECTIONS = [
  { id: 'company', label: 'Company Profile', icon: Building2 },
  { id: 'users', label: 'User & Role Management', icon: Users },
  { id: 'documents', label: 'Employee Document Config', icon: FileText },
  { id: 'attendance', label: 'Attendance Config', icon: Clock },
  { id: 'leave', label: 'Leave Policy', icon: CalendarOff },
  { id: 'payroll', label: 'Payroll Settings', icon: DollarSign },
  { id: 'notifications', label: 'Notifications & Email', icon: Bell },
  { id: 'recruitment', label: 'Recruitment Settings', icon: Briefcase },
  { id: 'announcements', label: 'Announcement Settings', icon: Megaphone },
  { id: 'assets', label: 'Asset Settings', icon: Monitor },
  { id: 'expenses', label: 'Expense Settings', icon: Receipt },
  { id: 'training', label: 'Training Settings', icon: GraduationCap },
  { id: 'helpdesk', label: 'Helpdesk Settings', icon: LifeBuoy },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'backup', label: 'Data & Backup', icon: Database },
];

const ROLE_TONE = { admin: 'primary', hr: 'teal', manager: 'info', employee: 'neutral' };

const PERMISSION_ROLE_LABELS = { admin: 'Admin', hr: 'HR', manager: 'Manager', employee: 'Employee' };

function RolePermissionsMatrix() {
  const [activeRole, setActiveRole] = useState('employee');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const rolePermissions = useSettingsStore((s) => s.rolePermissions);
  const updateRolePermission = useSettingsStore((s) => s.updateRolePermission);
  const updateRoleModuleAll = useSettingsStore((s) => s.updateRoleModuleAll);
  const resetRolePermissions = useSettingsStore((s) => s.resetRolePermissions);
  const isPrivilegedMatrixRole = isPrivilegedRole(activeRole);

  const saveMatrix = async () => {
    setSaving(true);
    try {
      await updateSettingApi('role_permissions', rolePermissions);
      await invalidateAndRefetch(queryClient, ['settings', 'role_permissions']);
      toast.success('Role permissions saved — applies for all users on their next refresh');
    } catch (err) {
      toast.error(err.message || 'Saved locally; server sync failed');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    resetRolePermissions();
    toast.success('Restored default grants (click Save to persist to server)');
  };

  const rowState = (mod) => {
    if (isPrivilegedMatrixRole) return { all: true, some: false };
    const cells = PERMISSION_ACTIONS.map((a) => !!rolePermissions[activeRole]?.[mod]?.[a]);
    const on = cells.filter(Boolean).length;
    return { all: on === PERMISSION_ACTIONS.length, some: on > 0 && on < PERMISSION_ACTIONS.length };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {RBAC_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setActiveRole(r)}
            className={cn(
              'rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              activeRole === r ? 'bg-primary text-white' : 'bg-muted text-fg-muted hover:bg-muted/70'
            )}
          >
            {PERMISSION_ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {isPrivilegedMatrixRole && (
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Lock className="h-3.5 w-3.5" /> {PERMISSION_ROLE_LABELS[activeRole]} has unrestricted access to every module — this row can't be edited.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">Module</th>
              <th className="py-2.5 px-1.5 font-semibold text-fg-subtle text-xs uppercase tracking-wide text-center whitespace-nowrap">All</th>
              {PERMISSION_ACTIONS.map((a) => (
                <th key={a} className="py-2.5 px-1.5 font-semibold text-fg-subtle text-xs uppercase tracking-wide text-center">{humanize(a)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((mod) => {
              const { all, some } = rowState(mod);
              return (
                <tr key={mod} className="border-b border-border/50">
                  <td className="py-2 pr-3 text-fg whitespace-nowrap">{MODULE_LABELS[mod]}</td>
                  <td className="text-center py-2 px-1.5">
                    <input
                      type="checkbox"
                      checked={all}
                      ref={(el) => { if (el) el.indeterminate = some; }}
                      disabled={isPrivilegedMatrixRole}
                      onChange={(e) => updateRoleModuleAll(activeRole, mod, e.target.checked)}
                      aria-label={`Select all — ${MODULE_LABELS[mod]} — ${PERMISSION_ROLE_LABELS[activeRole]}`}
                      title="Select all actions for this module"
                      className="h-4 w-4 rounded border-border text-primary accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                  </td>
                  {PERMISSION_ACTIONS.map((action) => {
                    const checked = isPrivilegedMatrixRole ? true : !!rolePermissions[activeRole]?.[mod]?.[action];
                    return (
                      <td key={action} className="text-center py-2 px-1.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isPrivilegedMatrixRole}
                          onChange={(e) => updateRolePermission(activeRole, mod, action, e.target.checked)}
                          aria-label={`${humanize(action)} — ${MODULE_LABELS[mod]} — ${PERMISSION_ROLE_LABELS[activeRole]}`}
                          className="h-4 w-4 rounded border-border text-primary accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={resetDefaults}>
          Reset to defaults
        </Button>
        <Button type="button" icon={Save} size="sm" loading={saving} onClick={saveMatrix}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
const TIMEZONES = ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London'];
const STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Delhi', 'Telangana'];
const COUNTRIES = ['India', 'United States', 'United Kingdom'];

function CompanyProfileSection() {
  const qc = useQueryClient();
  const { company, updateCompany } = useCompanyStore();
  const [form, setForm] = useState(company);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  // Rehydrate after bootstrap loads company_profile from server
  useEffect(() => {
    setForm({ ...company, ...mergeLegalProfile(company) });
  }, [company]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logoFile]);

  const save = async () => {
    setSaving(true);
    try {
      let next = { ...form };
      if (logoFile) {
        const uploaded = await uploadCompanyLogoApi(logoFile);
        next = {
          ...next,
          logoPath: uploaded.logoPath,
          logoUrl: uploaded.logoUrl,
          logoName: uploaded.logoName,
        };
        setLogoFile(null);
      }
      const payload = { ...next };
      delete payload.logoUrl;
      if (!payload.logoPath) {
        delete payload.logoPath;
        delete payload.logoName;
      }
      updateCompany(next);
      await updateSettingApi('company_profile', payload);
      await invalidateAndRefetch(qc, ['settings', 'company-profile']);
      await invalidateAndRefetch(qc, ['companies']);
      setForm(next);
      toast.success('Company profile saved to server');
    } catch (err) {
      toast.error(err.message || 'Saved locally; server sync failed');
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(save);

  const uploadLogoNow = async (file) => {
    setLogoFile(file);
    if (!file) return;
    try {
      const uploaded = await uploadCompanyLogoApi(file);
      const patch = {
        logoPath: uploaded.logoPath,
        logoUrl: uploaded.logoUrl,
        logoName: uploaded.logoName,
      };
      setForm((f) => ({ ...f, ...patch }));
      updateCompany(patch);
      setLogoFile(null);
      await invalidateAndRefetch(qc, ['settings', 'company-profile']);
      await invalidateAndRefetch(qc, ['companies']);
      toast.success('Company logo updated');
    } catch (err) {
      toast.error(err.message || 'Could not upload logo');
    }
  };

  const displayLogoUrl = logoPreview || form.logoUrl;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
        <p className="text-sm font-semibold text-fg">Sidebar brand logo</p>
        <p className="text-xs text-fg-muted mt-1 mb-3">
          Admin and HR can replace the wordmark shown at the top of the sidebar. Use a wide PNG or JPG (icon + company name), similar to a finance-dashboard lockup.
        </p>
        {displayLogoUrl ? (
          <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex h-16 items-center justify-start rounded-xl border border-border bg-card px-4 py-2">
              <img
                src={displayLogoUrl}
                alt="Sidebar logo preview"
                className="h-10 w-auto max-w-[240px] object-contain object-left"
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg truncate">{logoFile?.name || form.logoName || 'Current logo'}</p>
              <p className="text-xs text-fg-subtle">Applies to the sidebar as soon as you pick a file</p>
            </div>
          </div>
        ) : null}
        <FileUpload
          accept=".png,.jpg,.jpeg"
          multiple={false}
          maxSizeMB={2}
          hint="PNG or JPG · up to 2MB · full wordmark recommended"
          onChange={(files) => uploadLogoNow(files[0] || null)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Company name" required placeholder="e.g. Acme Technologies Pvt. Ltd." value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Industry" options={INDUSTRIES} placeholder="Select industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        <Select label="Company size" options={COMPANY_SIZES} placeholder="Select size" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
        <Input label="Founded year" type="number" placeholder="e.g. 2018" value={form.foundedYear} onChange={(e) => setForm({ ...form, foundedYear: e.target.value })} />
        <Input label="Website URL" placeholder="https://www.company.com" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        <Input label="Tagline" placeholder="e.g. Building tomorrow, today." value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
        <Select label="Financial year start" options={[{ value: 'April', label: 'April' }, { value: 'January', label: 'January' }]} value={form.fyStart || 'April'} onChange={(e) => setForm({ ...form, fyStart: e.target.value })} />
        <Select label="Default currency" options={CURRENCIES} value={form.currency || 'INR'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
        <Select label="Timezone" options={TIMEZONES} value={form.timezone || 'Asia/Kolkata'} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">Primary brand color</label>
          <div className="flex items-center gap-2.5">
            <input type="color" value={form.brandColor} onChange={(e) => { setForm({ ...form, brandColor: e.target.value }); updateCompany({ brandColor: e.target.value }); }} className="h-10 w-12 rounded-input border border-border bg-card cursor-pointer" />
            <Input className="flex-1" placeholder="e.g. #6C63FF" value={form.brandColor} onChange={(e) => { setForm({ ...form, brandColor: e.target.value }); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) updateCompany({ brandColor: e.target.value }); }} />
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 pt-5">
        <p className="text-sm font-semibold text-fg mb-3">Address</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Address line 1" placeholder="e.g. 4th Floor, Nexus Tower" containerClass="sm:col-span-2" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
          <Input label="Address line 2" placeholder="e.g. Koramangala 5th Block" containerClass="sm:col-span-2" value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
          <Input label="City" placeholder="e.g. Bengaluru" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Select label="State" options={STATES} placeholder="Select state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <Input label="Pincode" placeholder="e.g. 560095" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
          <Select label="Country" options={COUNTRIES} placeholder="Select country" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        </div>
      </div>

      <div className="border-t border-border/60 pt-5">
        <p className="text-sm font-semibold text-fg mb-1">Legal & CDD</p>
        <p className="text-xs text-fg-muted mb-4">
          GSTIN, directors, founders, and statutory IDs shown on Organizations when someone opens this company. Admin and HR can update these anytime.
        </p>
        <CompanyLegalFields form={form} setForm={setForm} />
      </div>

      <div className="border-t border-border/60 pt-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Contact name" placeholder="e.g. Riya Sharma" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          <Input label="Contact email" type="email" placeholder="e.g. riya.sharma@company.com" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          <Input label="Contact phone" placeholder="e.g. +91-9876543210" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button icon={Save} onClick={save} loading={saving} disabled={saving}>Save Changes</Button>
      </div>
    </div>
  );
}

function UserRoleSection() {
  const { employees, isLoading } = useEmployees();
  const columns = [
    {
      accessorKey: 'name', header: 'User',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.original.name} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-fg truncate">{row.original.name}</p>
            <p className="text-xs text-fg-subtle truncate">{row.original.workEmail || row.original.email}</p>
          </div>
        </div>
      ),
    },
    { accessorKey: 'role', header: 'Role', cell: ({ getValue }) => <Badge tone={ROLE_TONE[getValue()] || 'neutral'}>{getValue()}</Badge> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    {
      id: 'department',
      header: 'Department',
      cell: ({ row }) => <span className="text-xs text-fg-muted">{row.original.department || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="All users"
          subtitle={isLoading ? 'Loading accounts…' : `${employees.length} accounts from your company directory`}
        />
        {isLoading ? (
          <div className="p-5 text-sm text-fg-subtle">Loading users…</div>
        ) : (
          <DataTable columns={columns} data={employees} pageSize={8} />
        )}
      </Card>

      <Card>
        <CardHeader title="Role permissions matrix" subtitle="Configure what each role can do per module. Toggles update this browser immediately; Save Changes syncs for all users." />
        <div className="px-5 pb-5">
          <RolePermissionsMatrix />
        </div>
      </Card>
    </div>
  );
}

const SECTION_BODY = {
  documents: DocumentConfigSection,
  attendance: AttendanceConfigSection,
  leave: LeavePolicySection,
  payroll: PayrollSettingsSection,
  notifications: NotificationsSection,
  recruitment: RecruitmentSettingsSection,
  announcements: AnnouncementSettingsSection,
  assets: AssetSettingsSection,
  expenses: ExpenseSettingsSection,
  training: TrainingSettingsSection,
  helpdesk: HelpdeskSettingsSection,
  integrations: IntegrationsSection,
  security: SecuritySection,
  backup: DataBackupSection,
};

export default function Settings() {
  const canManageSettings = useCan('settings', 'manage');
  const sections = canManageSettings ? SECTIONS : [];
  const [section, setSection] = useState('company');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [hoverTip, setHoverTip] = useState(null);
  const [mobileDrilledIn, setMobileDrilledIn] = useState(false);
  const active = sections.find((s) => s.id === section) || sections[0];
  const BodyComponent = active ? SECTION_BODY[active.id] : null;

  if (!canManageSettings || !active) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Settings" subtitle="Global control panel — configuration, roles & policy rules" />
        <Card className="mt-6 p-8 text-center">
          <p className="text-sm text-fg-muted">You do not have permission to manage settings. Contact an Admin or HR.</p>
        </Card>
      </div>
    );
  }

  const selectSection = (id) => {
    setSection(id);
    setMobileDrilledIn(true); // only matters below lg — desktop always shows both columns
  };

  return (
    <div className="flex flex-col lg:h-[calc(100vh-7rem)] animate-fade-in">
      <div className="shrink-0">
        <PageHeader title="Settings" subtitle="Global control panel — configuration, roles & policy rules" />
      </div>

      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0 gap-4 mt-6">
        <div className={cn('shrink-0 flex-col w-full lg:min-h-0 lg:flex', navCollapsed ? 'lg:w-14' : 'lg:w-[200px]', mobileDrilledIn ? 'hidden lg:flex' : 'flex')}>
          <nav className="space-y-0.5 lg:overflow-y-auto lg:min-h-0">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSection(s.id)}
                onMouseEnter={(e) => {
                  if (!navCollapsed) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoverTip({ label: s.label, top: rect.top + rect.height / 2, left: rect.right + 8 });
                }}
                onMouseLeave={() => setHoverTip(null)}
                className={cn(
                  'flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm text-left transition-colors',
                  navCollapsed && 'lg:justify-center lg:px-0',
                  s.id === section ? 'bg-primary/10 text-primary font-medium' : 'text-fg-muted hover:bg-muted hover:text-fg'
                )}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span className={cn('truncate', navCollapsed && 'lg:hidden')}>{s.label}</span>
              </button>
            ))}
          </nav>

          <button
            onClick={() => setNavCollapsed((c) => !c)}
            className={cn(
              'hidden lg:flex items-center gap-2 mt-2 px-3 py-2 rounded-xl text-xs text-fg-subtle hover:bg-muted hover:text-fg transition-colors shrink-0',
              navCollapsed && 'justify-center px-0'
            )}
          >
            <ChevronsLeft className={cn('h-4 w-4 transition-transform', navCollapsed && 'rotate-180')} />
            {!navCollapsed && 'Collapse'}
          </button>
        </div>

        <div className={cn('min-w-0 flex-1 lg:overflow-y-auto lg:min-h-0 pb-2 lg:block', mobileDrilledIn ? 'block' : 'hidden lg:block')}>
          <button
            onClick={() => setMobileDrilledIn(false)}
            className="lg:hidden flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-4 -mt-1"
          >
            <ChevronsLeft className="h-4 w-4" /> Back to Settings
          </button>

          {active.id === 'company' && (
            <Card>
              <CardHeader title="Company Profile" subtitle="Branding, company details, and contact. Admin and HR can change the sidebar logo here." />
              <div className="p-5 pt-3"><CompanyProfileSection /></div>
            </Card>
          )}
          {active.id === 'users' && <UserRoleSection />}
          {BodyComponent && <BodyComponent />}
        </div>
      </div>

      {hoverTip && createPortal(
        <span
          style={{ position: 'fixed', top: hoverTip.top, left: hoverTip.left, transform: 'translateY(-50%)' }}
          className="pointer-events-none whitespace-nowrap rounded-lg bg-fg text-card text-xs font-medium px-2.5 py-1.5 shadow-lg z-[100]"
        >
          {hoverTip.label}
        </span>,
        document.body
      )}
    </div>
  );
}
