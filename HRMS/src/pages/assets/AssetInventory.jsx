import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Monitor, Plus, Laptop, Smartphone, Tablet, Armchair, Mouse, Package,
  User, Boxes, Check, UserPlus, RotateCcw, Upload, Download,
} from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, StatusBadge, Badge, Modal, Input, Select, DataTable, Skeleton } from '../../components/ui';
import { useAssets, useAssetCategories, useAssetMutations } from '../../hooks/useModules';
import { useEmployeeMap, useEmployees } from '../../hooks/useEmployees';
import { resolveCategoryOptions } from '../../api/assets.api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { ExportButton } from '../../components/shared/ExportButton';
import { AssetImportModal, downloadAssetExcelTemplate } from '../../components/shared/AssetImportModal';
import toast from 'react-hot-toast';

const CAT_ICON = {
  Laptop, Phone: Smartphone, Tablet, Monitor, Furniture: Armchair, Peripheral: Mouse,
};

export default function AssetInventory() {
  const queryClient = useQueryClient();
  const { data: assets = [], isLoading } = useAssets();
  const { data: categories = [] } = useAssetCategories();
  const { createAsset, assignAsset, returnAsset } = useAssetMutations();
  const employeeMap = useEmployeeMap();
  const { employees = [] } = useEmployees();
  const categoryOptions = useMemo(() => resolveCategoryOptions(categories), [categories]);

  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [form, setForm] = useState({
    name: '', category: '', brand: '', model: '', serialNumber: '', location: '',
    ownership: 'purchased', purchaseCost: '', purchaseDate: '', warrantyExpiry: '',
  });

  const refreshAfterImport = async () => {
    await invalidateAndRefetch(queryClient, ['assets']);
    await invalidateAndRefetch(queryClient, ['dashboard']);
  };

  const employeeOptions = useMemo(
    () => employees
      .filter((e) => e.isActive !== false)
      .map((e) => ({ value: e.id, label: `${e.name}${e.department ? ` · ${e.department}` : ''}` })),
    [employees],
  );

  const filtered = useMemo(
    () => assets.filter((a) => (!category || a.category === category) && (!status || a.status === status)),
    [assets, category, status],
  );

  const summary = useMemo(() => ({
    total: assets.length,
    assigned: assets.filter((a) => a.status === 'assigned').length,
    available: assets.filter((a) => a.status === 'available').length,
    repair: assets.filter((a) => a.status === 'in-repair').length,
  }), [assets]);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Asset name is required');
    try {
      await createAsset.mutateAsync({
        name: form.name.trim(),
        category: form.category || undefined,
        brand: form.brand.trim() || undefined,
        model: form.model.trim() || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
        location: form.location.trim() || undefined,
        ownership: form.ownership || 'purchased',
        purchaseCost: Number(form.purchaseCost || 0),
        purchaseDate: form.purchaseDate || null,
        warrantyExpiry: form.warrantyExpiry || null,
      });
      setModal(false);
      setForm({ name: '', category: '', brand: '', model: '', serialNumber: '', location: '', ownership: 'purchased', purchaseCost: '', purchaseDate: '', warrantyExpiry: '' });
      toast.success('Asset added to inventory');
    } catch (err) {
      toast.error(err.message || 'Failed to add asset');
    }
  };

  const doAssign = async () => {
    if (!assignModal?.id || !assignEmployeeId) return toast.error('Select an employee');
    try {
      await assignAsset.mutateAsync({ id: assignModal.id, employeeId: assignEmployeeId });
      toast.success('Asset assigned');
      setAssignModal(null);
      setAssignEmployeeId('');
    } catch (err) {
      toast.error(err.message || 'Assignment failed');
    }
  };

  const doReturn = async (asset) => {
    try {
      await returnAsset.mutateAsync(asset.id);
      toast.success('Asset returned to inventory');
    } catch (err) {
      toast.error(err.message || 'Return failed');
    }
  };

  const columns = [
    {
      accessorKey: 'name', header: 'Asset',
      cell: ({ row }) => {
        const Icon = CAT_ICON[row.original.category] || Package;
        return (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-fg">{row.original.name}</p>
              <p className="text-xs text-fg-subtle">{row.original.id?.slice(0, 8)} · {row.original.serialNumber || '—'}</p>
            </div>
          </div>
        );
      },
    },
    { accessorKey: 'category', header: 'Category' },
    // Every column the bulk-import template collects is shown here, in the
    // same order, so what you fill in is what you see back.
    { accessorKey: 'brand', header: 'Brand', cell: ({ getValue }) => getValue() || '—' },
    { accessorKey: 'model', header: 'Model', cell: ({ getValue }) => getValue() || '—' },
    { accessorKey: 'serialNumber', header: 'Serial', cell: ({ getValue }) => getValue() || '—' },
    {
      accessorKey: 'ownership',
      header: 'Ownership',
      cell: ({ getValue }) => (
        <Badge tone={getValue() === 'rented' ? 'warning' : 'neutral'}>
          {getValue() === 'rented' ? 'Rented' : 'Purchased'}
        </Badge>
      ),
    },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    {
      accessorKey: 'assignedTo', header: 'Assigned to',
      cell: ({ getValue, row }) => {
        const e = employeeMap[getValue()];
        return getValue() ? (
          <span className="flex items-center gap-1.5 text-sm">
            <User className="h-3.5 w-3.5 text-fg-subtle" />
            {e?.name || 'Assigned'}
            {row.original.exitRecovery ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                Recover
              </span>
            ) : null}
          </span>
        ) : '—';
      },
    },
    {
      accessorKey: 'purchaseDate',
      header: 'Purchased on',
      cell: ({ getValue }) => (getValue() ? formatDate(getValue()) : '—'),
    },
    { accessorKey: 'purchaseCost', header: 'Cost', cell: ({ getValue }) => formatCurrency(getValue() || 0) },
    {
      accessorKey: 'currentValue',
      header: 'Book value',
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(row.original.currentValue ?? row.original.purchaseCost ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: 'warrantyExpiry',
      header: 'Warranty expiry',
      cell: ({ getValue }) => (getValue() ? formatDate(getValue()) : '—'),
    },
    { accessorKey: 'location', header: 'Location', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const a = row.original;
        const isAssigned = a.status === 'assigned' && a.assignedTo;
        return (
          <div className="flex items-center gap-1 justify-end">
            {isAssigned ? (
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => doReturn(a)} aria-label="Return asset">
                Return
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={UserPlus}
                onClick={() => { setAssignModal(a); setAssignEmployeeId(''); }}
                aria-label="Assign asset"
              >
                Assign
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const exportRows = useMemo(
    () => filtered.map((a) => ({
      name: a.name,
      category: a.category,
      brand: a.brand || '',
      model: a.model || '',
      serial: a.serialNumber,
      ownership: a.ownership,
      purchaseDate: a.purchaseDate || '',
      cost: a.purchaseCost || 0,
      warrantyExpiry: a.warrantyExpiry || '',
      location: a.location || '',
      status: a.status,
      assignedTo: a.assignedTo ? (employeeMap[a.assignedTo]?.name || a.assignedTo) : '',
    })),
    [filtered, employeeMap],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Asset Inventory"
        subtitle="Track company equipment, assignments and lifecycle"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {/* Template download sits here, not inside the dialog — the sheet
                has to be filled in before there is anything to import. */}
            <Button variant="ghost" icon={Download} onClick={downloadAssetExcelTemplate}>
              Excel Template
            </Button>
            <Button variant="outline" icon={Upload} onClick={() => setImportOpen(true)}>Bulk Import</Button>
            <Button icon={Plus} onClick={() => setModal(true)}>Add Asset</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total assets', value: summary.total, icon: Boxes },
          { label: 'Assigned', value: summary.assigned, icon: User },
          { label: 'Available', value: summary.available, icon: Check },
          { label: 'In repair', value: summary.repair, icon: Monitor },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-5 w-5" /></div>
            <div><p className="text-xl font-semibold text-fg">{value}</p><p className="text-xs text-fg-subtle">{label}</p></div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="All Assets"
          subtitle={`${filtered.length} items`}
          action={
            <div className="flex gap-2 flex-wrap">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={categoryOptions} className="h-9 text-xs" />
              <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={['available', 'assigned', 'in-repair', 'retired']} className="h-9 text-xs" />
              <ExportButton rows={exportRows} filename="assets" title="Asset Inventory" columns={['name', 'category', 'serial', 'status', 'assignedTo', 'cost']} />
            </div>
          }
        />
        {isLoading ? <Skeleton className="h-48 m-5 rounded-xl" /> : <DataTable columns={columns} data={filtered} pageSize={10} />}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Add Asset" footer={<><Button variant="outline" onClick={() => setModal(false)}>Cancel</Button><Button onClick={save} disabled={createAsset.isPending}>Save</Button></>}>
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select label="Category" options={categoryOptions} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Select category" />
          {/* Same fields the bulk-import template collects, so an asset added
              by hand records exactly as much as an imported one. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Serial number" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
            <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Ownership"
              value={form.ownership}
              onChange={(e) => setForm({ ...form, ownership: e.target.value })}
              options={[{ value: 'purchased', label: 'Purchased' }, { value: 'rented', label: 'Rented' }]}
            />
            <Input label="Purchase cost" type="number" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Purchase date" type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
            <Input label="Warranty expiry" type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(assignModal)}
        onClose={() => { setAssignModal(null); setAssignEmployeeId(''); }}
        title={`Assign — ${assignModal?.name || 'Asset'}`}
        footer={<><Button variant="outline" onClick={() => setAssignModal(null)}>Cancel</Button><Button onClick={doAssign} disabled={assignAsset.isPending}>Assign</Button></>}
      >
        <Select
          label="Employee"
          placeholder="Select employee"
          options={employeeOptions}
          value={assignEmployeeId}
          onChange={(e) => setAssignEmployeeId(e.target.value)}
        />
      </Modal>

      {/* Bulk import writes straight through the assets API rather than the
          mutation hooks, so refresh the list (and the category filter, which
          grows when an imported asset introduces a new category) here. */}
      <AssetImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingAssets={assets}
        employees={employees}
        onImported={refreshAfterImport}
      />
    </div>
  );
}
