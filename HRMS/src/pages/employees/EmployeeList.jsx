import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Users, Check, X, Search, Filter, MoreVertical, Eye, Pencil,
  Trash2, ChevronDown, LayoutGrid, List, Network, Building2,
} from 'lucide-react';
import {
  Card, Button, Avatar, StatusBadge, Select, Tabs, DataTable, EmptyState, ConfirmDialog, Skeleton, Badge,
} from '../../components/ui';
import { DEPARTMENTS } from '../../lib/constants';
import { useEmployees, useEmployeeMutations } from '../../hooks/useEmployees';
import { useAccessibleCompanies } from '../../hooks/useCompanies';
import { useSettingsStore } from '../../store/settingsStore';
import { useCompanyStore } from '../../store/companyStore';
import { useCan } from '../../hooks/useCan';
import { useDropdown, handleMenuArrowKeys } from '../../hooks/useDropdown';
import { ExportButton } from '../../components/shared/ExportButton';
import { ChangeCompanyModal } from '../../components/shared/ChangeCompanyModal';
import { companyTypeLabel } from '../../lib/companyLabels';
import { formatDate, cn } from '../../lib/utils';
import { employeeProfilePath, employeeEditPath, filterDirectoryEmployees } from '../../lib/employeeRoutes';
import toast from 'react-hot-toast';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const STATUS_META = {
  active: { label: 'Active', dot: 'bg-success' },
  probation: { label: 'Probation', dot: 'bg-warning' },
  'on-leave': { label: 'On Leave', dot: 'bg-info' },
  resigned: { label: 'Resigned', dot: 'bg-danger' },
  'pending-setup': { label: 'Pending Setup', dot: 'bg-fg-subtle' },
};

const EMP_TYPE_META = {
  'full-time': { label: 'Full-Time', cls: 'bg-primary/10 text-primary' },
  intern: { label: 'Internship', cls: 'bg-pink-500/10 text-pink-500' },
  contract: { label: 'Contract', cls: 'bg-violet-500/10 text-violet-500' },
  'part-time': { label: 'Part-Time', cls: 'bg-warning/12 text-warning' },
};

function InfoRow({ label, value, truncate, action }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="shrink-0 text-fg-subtle">{label}</span>
      <div className="min-w-0 flex items-center justify-end gap-2">
        <span className={cn('font-medium text-fg text-right', truncate && 'truncate')} title={truncate ? value : undefined}>
          {value || '—'}
        </span>
        {action}
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger, first }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      autoFocus={first}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors focus:outline-none',
        danger
          ? 'text-danger hover:bg-danger/8 focus-visible:bg-danger/8'
          : 'text-fg-muted hover:bg-primary/8 hover:text-fg focus-visible:bg-primary/8'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </button>
  );
}

/** Directory card — status + actions menu on top, centred identity, meta rows. */
function DirectoryCard({ e, canEdit, canDelete, canChangeCompany, onDetails, onEdit, onDelete, onChangeCompany }) {
  const { open, setOpen, close, containerRef, triggerRef } = useDropdown();
  const panelRef = useRef(null);
  const status = STATUS_META[e.status] || { label: e.status, dot: 'bg-fg-subtle' };
  const type = EMP_TYPE_META[e.employmentType] || { label: e.employmentType || 'Employee', cls: 'bg-muted text-fg-muted' };

  return (
    <Card hover className={cn('relative p-5', open && 'z-20')}>
      {/* Top row: status + actions menu */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>

        <div className="relative" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Actions for ${e.name}`}
            onClick={() => setOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {open && (
            <div
              ref={panelRef}
              role="menu"
              aria-label={`${e.name} actions`}
              onKeyDown={(ev) => handleMenuArrowKeys(ev, panelRef)}
              className="absolute right-0 top-full z-30 mt-1.5 w-48 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-card-hover animate-scale-in"
            >
              <MenuItem icon={Eye} first onClick={() => { close(); onDetails(); }}>Details</MenuItem>
              {canEdit && <MenuItem icon={Pencil} onClick={() => { close(); onEdit(); }}>Edit</MenuItem>}
              {canChangeCompany && (
                <MenuItem icon={Building2} onClick={() => { close(); onChangeCompany(); }}>
                  Change company
                </MenuItem>
              )}
              {canDelete && <MenuItem icon={Trash2} danger onClick={() => { close(); onDelete(); }}>Delete</MenuItem>}
            </div>
          )}
        </div>
      </div>

      {/* Identity — clickable to open profile */}
      <button type="button" onClick={onDetails} className="group mt-1 block w-full text-center focus:outline-none">
        <Avatar employee={e} name={e.name} size="xl" className="mx-auto ring-4 ring-muted/50" />
        <p className="mt-3 font-semibold text-fg group-hover:text-primary transition-colors">{e.name}</p>
        <p className="mt-0.5 text-sm text-fg-muted">
          {e.designation} <span className="text-fg-subtle">|</span> {e.department}
        </p>
      </button>

      {/* Employment type pill */}
      <div className="mt-2.5 flex justify-center">
        <span className={cn('rounded-pill px-3 py-1 text-xs font-medium', type.cls)}>{type.label}</span>
      </div>

      {/* Meta rows */}
      <div className="mt-4 space-y-2.5 border-t border-border/60 pt-4">
        <InfoRow
          label="Company"
          value={e.companyName || '—'}
          action={canChangeCompany ? (
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); onChangeCompany?.(); }}
              className="shrink-0 text-xs font-semibold text-primary hover:underline"
            >
              Change
            </button>
          ) : null}
        />
        <InfoRow label="Office Branch" value={e.workLocation} />
        <InfoRow label="Phone Number" value={e.phone} />
        <InfoRow label="Email" value={e.workEmail} truncate />
      </div>
    </Card>
  );
}

/** Simple, real org tree built from the reporting hierarchy. */
function OrgNode({ emp, childrenOf, depth, onSelect }) {
  const kids = childrenOf[emp.id] || [];
  const [open, setOpen] = useState(depth < 2);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {kids.length > 0 ? (
          <button
            type="button"
            aria-label={open ? 'Collapse reports' : 'Expand reports'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} />
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(emp)}
          className="flex flex-1 items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Avatar employee={emp} name={emp.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{emp.name}</p>
            <p className="truncate text-xs text-fg-subtle">{emp.designation} · {emp.department}</p>
          </div>
          {kids.length > 0 && (
            <span className="rounded-pill bg-muted px-2 py-0.5 text-[10px] font-semibold text-fg-subtle">
              {kids.length} report{kids.length > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </div>
      {open && kids.length > 0 && (
        <div className="ml-3 mt-2 space-y-2 border-l border-border pl-4">
          {kids.map((k) => (
            <OrgNode key={k.id} emp={k} childrenOf={childrenOf} depth={depth + 1} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrgChart({ employees, onSelect }) {
  const { roots, childrenOf } = useMemo(() => {
    const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
    const map = {};
    employees.forEach((e) => {
      const parent = e.reportingTo && byId[e.reportingTo] ? e.reportingTo : '__root__';
      (map[parent] = map[parent] || []).push(e);
    });
    return { roots: map.__root__ || [], childrenOf: map };
  }, [employees]);

  return (
    <div className="space-y-3">
      {roots.map((r) => (
        <OrgNode key={r.id} emp={r} childrenOf={childrenOf} depth={0} onSelect={onSelect} />
      ))}
    </div>
  );
}

const TABS = [
  { id: 'list', label: 'Employee List', icon: List },
  { id: 'directory', label: 'Directory', icon: LayoutGrid },
  { id: 'org', label: 'ORG Chart', icon: Network },
];
export default function EmployeeList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hiredThisMonth = searchParams.get('hired') === 'this-month';
  const companyFromUrl = searchParams.get('company') || '';
  const canManage = useCan('employees', 'create');
  const canEdit = useCan('employees', 'edit');
  const canDelete = useCan('employees', 'delete') || canEdit;
  const { remove } = useEmployeeMutations();
  const { employees, isLoading, isError, refetch } = useEmployees();
  const companiesQ = useAccessibleCompanies(true);
  const brandedCompany = useCompanyStore((s) => s.company);
  const brandedHomeName = brandedCompany?.name?.trim();
  const companyNameById = useMemo(() => {
    const map = new Map();
    for (const c of companiesQ.data || []) {
      map.set(String(c.id), {
        name: c.isHome && brandedHomeName ? brandedHomeName : c.name,
        type: c.companyType,
        isHome: c.isHome,
      });
    }
    return map;
  }, [companiesQ.data, brandedHomeName]);

  const roster = useMemo(() => {
    return filterDirectoryEmployees(employees).map((e) => {
      const cid = String(e.companyId || e.company_id || '');
      const meta = companyNameById.get(cid);
      const resolvedName = meta?.isHome && brandedHomeName
        ? brandedHomeName
        : e.companyName || e.company?.name || meta?.name;
      return {
        ...e,
        companyId: cid || e.companyId || null,
        companyName: resolvedName || (cid ? 'Unknown company' : 'Unassigned'),
        companyType: meta?.type || e.companyType || '',
      };
    });
  }, [employees, companyNameById, brandedHomeName]);

  const locations = useSettingsStore((s) => s.locations);
  const addLocation = useSettingsStore((s) => s.addLocation);

  const [tab, setTab] = useState('directory');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [company, setCompany] = useState(companyFromUrl);
  const [showFilters, setShowFilters] = useState(Boolean(companyFromUrl));
  const [addingLocation, setAddingLocation] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [changeCompanyEmp, setChangeCompanyEmp] = useState(null);
  const canChangeCompany = canEdit || canManage;

  useEffect(() => {
    setCompany(companyFromUrl);
    if (companyFromUrl) setShowFilters(true);
  }, [companyFromUrl]);

  const setCompanyFilter = (value) => {
    setCompany(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('company', value);
    else next.delete('company');
    setSearchParams(next, { replace: true });
  };

  const companyOptions = useMemo(
    () => (companiesQ.data || []).map((c) => ({
      value: c.id,
      label: c.name,
    })),
    [companiesQ.data],
  );

  const activeFilterCount = [dept, status, location, company].filter(Boolean).length;

  const saveNewLocation = () => {
    const name = newLocation.trim();
    if (!name) { setAddingLocation(false); return; }
    if (locations.some((l) => l.toLowerCase() === name.toLowerCase())) {
      toast.error(`"${name}" already exists`);
      return;
    }
    addLocation(name);
    setLocation(name);
    toast.success(`"${name}" added to locations`);
    setNewLocation('');
    setAddingLocation(false);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return roster.filter(
      (e) => {
        if (hiredThisMonth) {
          const joined = e.joinDate || e.dateOfJoining;
          if (!joined) return false;
          const d = new Date(joined);
          if (Number.isNaN(d.getTime()) || d < monthStart) return false;
        }
        return (
          (!q || e.name?.toLowerCase().includes(q) || e.designation?.toLowerCase().includes(q) || String(e.id || '').toLowerCase().includes(q) || String(e.employeeCode || '').toLowerCase().includes(q)) &&
          (!dept || e.department === dept) &&
          (!status || e.status === status) &&
          (!location || e.workLocation === location) &&
          (!company || String(e.companyId || '') === String(company))
        );
      }
    );
  }, [roster, search, dept, status, location, company, hiredThisMonth]);

  const directoryGroups = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      const key = String(e.companyId || 'unassigned');
      if (!map.has(key)) {
        const meta = companyNameById.get(key);
        const groupName = meta?.isHome && brandedHomeName
          ? brandedHomeName
          : e.companyName || e.company?.name || meta?.name;
        map.set(key, {
          id: key,
          name: groupName || 'Unassigned',
          type: meta?.type || e.companyType || '',
          isHome: Boolean(meta?.isHome),
          employees: [],
        });
      }
      map.get(key).employees.push(e);
    }
    return [...map.values()].sort((a, b) => {
      if (a.isHome && !b.isHome) return -1;
      if (!a.isHome && b.isHome) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [filtered, companyNameById]);

  const clearHiredFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('hired');
    setSearchParams(next, { replace: true });
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Employee',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar employee={row.original} name={row.original.name} size="sm" />
            <div>
              <p className="font-medium text-fg">{row.original.name}</p>
              <p className="text-xs text-fg-subtle">{row.original.employeeCode || row.original.id}</p>
            </div>
          </div>
        ),
      },
      { accessorKey: 'companyName', header: 'Company' },
      { accessorKey: 'designation', header: 'Designation' },
      { accessorKey: 'department', header: 'Department' },
      { accessorKey: 'workLocation', header: 'Location' },
      { accessorKey: 'joinDate', header: 'Joined', cell: ({ getValue }) => formatDate(getValue()) },
      { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    ],
    []
  );

  const exportRows = useMemo(
    () => filtered.map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      name: e.name,
      company: e.companyName,
      designation: e.designation,
      department: e.department,
      location: e.workLocation,
      status: e.status,
      email: e.workEmail,
      joined: e.joinDate,
    })),
    [filtered]
  );

  const doDelete = async () => {
    const emp = confirmDelete;
    try {
      await remove.mutateAsync(emp.id);
      toast.success(`${emp.name} removed`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err.message || 'Failed to remove employee');
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {hiredThisMonth && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal/30 bg-teal/5 px-4 py-2.5 text-sm">
          <span className="text-fg-muted">
            Showing <span className="font-medium text-fg">new hires this month</span>
          </span>
          <button
            type="button"
            onClick={clearHiredFilter}
            className="text-xs font-medium text-primary hover:underline"
          >
            Show all employees
          </button>
        </div>
      )}

      {tab !== 'org' && (
        <Card className="p-4 sm:p-5 space-y-3">
          {companyOptions.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-medium text-fg shrink-0">
                <Building2 className="h-4 w-4 text-primary" />
                Company
              </div>
              <div className="flex flex-wrap gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => setCompanyFilter('')}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-medium border transition-colors',
                    !company
                      ? 'bg-primary text-white border-primary'
                      : 'bg-card text-fg-muted border-border hover:border-primary/40 hover:text-fg',
                  )}
                >
                  All companies
                </button>
                {companyOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCompanyFilter(opt.value)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-medium border transition-colors',
                      String(company) === String(opt.value)
                        ? 'bg-primary text-white border-primary'
                        : 'bg-card text-fg-muted border-border hover:border-primary/40 hover:text-fg',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, role or ID…"
                className="h-11 w-full rounded-xl border border-border bg-muted/50 pl-10 pr-16 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-fg-subtle sm:flex">
                {isMac ? '⌘F' : 'Ctrl F'}
              </kbd>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={showFilters || activeFilterCount ? 'primary' : 'outline'}
                icon={Filter}
                onClick={() => setShowFilters((v) => !v)}
              >
                Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}
              </Button>
              <ExportButton
                rows={exportRows}
                filename="employees"
                title="Employees"
                columns={['id', 'employeeCode', 'name', 'company', 'designation', 'department', 'location', 'status', 'email', 'joined']}
                size="md"
                label="Export"
              />
              {canManage && (
                <Button icon={Plus} onClick={() => navigate('/employees/new')}>
                  <span className="hidden sm:inline">Add</span>
                </Button>
              )}
            </div>
          </div>

          {showFilters && (
            <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
              <Select value={dept} onChange={(e) => setDept(e.target.value)} options={DEPARTMENTS} placeholder="All departments" className="sm:w-44" />
              <Select value={status} onChange={(e) => setStatus(e.target.value)} options={['active', 'probation', 'on-leave', 'resigned', 'pending-setup']} placeholder="All statuses" className="sm:w-40" />
              {addingLocation ? (
                <div className="flex items-center gap-1 sm:w-56">
                  <input
                    autoFocus
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); saveNewLocation(); }
                      if (e.key === 'Escape') { e.preventDefault(); setAddingLocation(false); setNewLocation(''); }
                    }}
                    placeholder="e.g. Pune, Chennai"
                    className="h-10 min-w-0 flex-1 rounded-input border border-primary bg-card px-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button type="button" onClick={saveNewLocation} aria-label="Save new location" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-primary text-white hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => { setAddingLocation(false); setNewLocation(''); }} aria-label="Cancel adding location" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input border border-border text-fg-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <Select value={location} onChange={(e) => setLocation(e.target.value)} options={locations} placeholder="All locations" className="sm:w-40" />
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setAddingLocation(true)}
                      aria-label="Add a new location"
                      title="Add a new location"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input border border-dashed border-border text-fg-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  onClick={() => {
                    setDept('');
                    setStatus('');
                    setLocation('');
                    setCompanyFilter('');
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {isLoading && roster.length === 0 ? (
        <Card className="p-5">
          <Skeleton className="h-64 w-full rounded-xl" />
        </Card>
      ) : isError ? (
        <Card className="py-6">
          <EmptyState
            icon={Users}
            title="Could not load employees"
            message="Check your connection and try again."
            action={<Button onClick={() => refetch()}>Retry</Button>}
          />
        </Card>
      ) : tab === 'org' ? (
        <Card className="p-5">
          <OrgChart employees={roster} onSelect={(e) => navigate(employeeProfilePath(e, roster))} />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-6">
          <EmptyState icon={Users} title="No employees found" message="Try adjusting your search or filters." />
        </Card>
      ) : tab === 'directory' ? (
        <div className="space-y-8">
          {directoryGroups.map((group) => (
            <section key={group.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-fg">{group.name}</h2>
                {group.type === 'parent' && <Badge tone="primary">{companyTypeLabel('parent')}</Badge>}
                {group.type === 'child' && <Badge tone="teal">{companyTypeLabel('child')}</Badge>}
                <span className="text-xs text-fg-subtle">
                  {group.employees.length} employee{group.employees.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.employees.map((e) => (
                  <DirectoryCard
                    key={e.id}
                    e={e}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    canChangeCompany={canChangeCompany}
                    onDetails={() => navigate(employeeProfilePath(e, roster))}
                    onEdit={() => navigate(employeeEditPath(e, roster))}
                    onDelete={() => setConfirmDelete(e)}
                    onChangeCompany={() => setChangeCompanyEmp(e)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <DataTable
            columns={columns}
            data={filtered}
            onRowClick={(e) => navigate(employeeProfilePath(e, roster))}
            pageSize={15}
            emptyTitle="No employees found"
            emptyMessage="Try adjusting your search or filters."
          />
        </Card>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title={`Remove ${confirmDelete?.name}?`}
        message="This removes the employee from the directory. This action cannot be undone."
        confirmLabel="Remove"
      />

      <ChangeCompanyModal
        open={Boolean(changeCompanyEmp)}
        employee={changeCompanyEmp}
        onClose={() => setChangeCompanyEmp(null)}
      />
    </div>
  );
}
