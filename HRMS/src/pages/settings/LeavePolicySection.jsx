import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Select, Toggle, Modal, Skeleton } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateLeavePolicyApi, applyLeavePolicyApi, updateSettingApi, fetchLeavePolicyApi } from '../../api/settings.api';
import { fetchHolidaysByYearApi, createHolidayApi, deleteHolidayApi } from '../../api/holidays.api';
import { formatDate } from '../../lib/utils';
import { invalidateAndRefetch } from '../../lib/queryCache';

const HOLIDAY_TYPE_OPTIONS = [
  { value: 'public', label: 'Public / National' },
  { value: 'optional', label: 'Optional' },
  { value: 'restricted', label: 'Restricted' },
];

/** Must match Postgres leave_type ENUM — custom codes cannot be stored in leave_balances. */
const ALLOWED_LEAVE_CODES = [
  'CL', 'SL', 'EL', 'WFH', 'COMP_OFF', 'MATERNITY', 'PATERNITY', 'UNPAID',
];
const LEAVE_CODE_OPTIONS = ALLOWED_LEAVE_CODES.map((c) => ({ value: c, label: c }));

function mapApiPolicyToUi(policy) {
  if (!Array.isArray(policy) || !policy.length) return null;
  return policy.map((t, i) => ({
    id: t.id || `LT-${t.code || i}`,
    code: t.code,
    name: t.name || t.code,
    daysPerYear: Number(t.allocation ?? t.daysPerYear ?? 0),
    carryForward: Boolean(t.carryForward ?? t.carry_forward),
    maxCarry: Number(t.maxCarry ?? t.max_carry ?? 0),
    encashment: Boolean(t.encashment),
    paid: t.paid !== false,
    active: t.active !== false,
  }));
}

function AddLeaveTypeModal({ open, onClose, onAdd, usedCodes = [] }) {
  const available = LEAVE_CODE_OPTIONS.filter((o) => !usedCodes.includes(o.value));
  const [form, setForm] = useState({
    name: '', code: available[0]?.value || 'CL', daysPerYear: '12', paid: true, carryForward: false, maxCarry: '0', encashment: false, active: true,
  });

  useEffect(() => {
    if (!open) return;
    const next = LEAVE_CODE_OPTIONS.filter((o) => !usedCodes.includes(o.value));
    setForm({
      name: '',
      code: next[0]?.value || 'CL',
      daysPerYear: '12',
      paid: true,
      carryForward: false,
      maxCarry: '0',
      encashment: false,
      active: true,
    });
  }, [open, usedCodes]);

  const save = () => {
    if (!form.name.trim()) return toast.error('Leave type name is required');
    if (!ALLOWED_LEAVE_CODES.includes(form.code)) {
      return toast.error(`Code must be one of: ${ALLOWED_LEAVE_CODES.join(', ')}`);
    }
    if (usedCodes.includes(form.code)) {
      return toast.error(`Leave code ${form.code} is already in the policy`);
    }
    onAdd({
      ...form,
      code: form.code,
      name: form.name.trim(),
      daysPerYear: Number(form.daysPerYear) || 0,
      maxCarry: Number(form.maxCarry) || 0,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Leave Type" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!available.length}>Add Leave Type</Button></>}>
      <div className="space-y-4">
        {!available.length ? (
          <p className="text-sm text-fg-muted">All supported leave codes are already in the policy.</p>
        ) : (
          <>
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="Code" hint="Must match database leave types" options={available} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Days per year" type="number" value={form.daysPerYear} onChange={(e) => setForm({ ...form, daysPerYear: e.target.value })} />
            <Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
            <Toggle label="Paid" checked={form.paid} onChange={(v) => setForm({ ...form, paid: v })} />
            <Toggle label="Allow carry forward" checked={form.carryForward} onChange={(v) => setForm({ ...form, carryForward: v })} />
            {form.carryForward && <Input label="Max carry-forward days" type="number" value={form.maxCarry} onChange={(e) => setForm({ ...form, maxCarry: e.target.value })} />}
            <Toggle label="Allow encashment" checked={form.encashment} onChange={(v) => setForm({ ...form, encashment: v })} />
          </>
        )}
      </div>
    </Modal>
  );
}

function AddHolidayModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ date: '', name: '', type: 'public' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.date || !form.name.trim()) return toast.error('Date and name are required');
    setSaving(true);
    try {
      const row = await createHolidayApi({ name: form.name.trim(), date: form.date, type: form.type });
      onCreated(row);
      toast.success('Holiday added');
      setForm({ date: '', name: '', type: 'public' });
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to add holiday');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Holiday" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Add Holiday</Button></>}>
      <div className="space-y-4">
        <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input label="Holiday name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Type" options={HOLIDAY_TYPE_OPTIONS} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
      </div>
    </Modal>
  );
}

export function LeavePolicySection() {
  const year = new Date().getFullYear();
  const qc = useQueryClient();
  const storePolicy = useSettingsStore((s) => s.leavePolicy);
  const syncStore = useSettingsStore((s) => s.updateLeavePolicy);
  const hydrated = useRef(false);

  const [leaveTypes, setLeaveTypes] = useState([]);
  const [form, setForm] = useState({
    approvalLevel: storePolicy.approvalLevel || 'single',
    accrualMethod: storePolicy.accrualMethod || 'upfront',
    autoDeduct: Boolean(storePolicy.autoDeduct),
  });
  const [ltModal, setLtModal] = useState(false);
  const [holModal, setHolModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [holidays, setHolidays] = useState([]);

  const policyQuery = useQuery({
    queryKey: ['settings', 'leave-policy'],
    queryFn: fetchLeavePolicyApi,
    staleTime: 60_000,
  });

  const holidaysQuery = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => fetchHolidaysByYearApi(year),
    staleTime: 60_000,
  });

  // Load once from API — fall back to store defaults when server has no policy yet
  useEffect(() => {
    if (hydrated.current || policyQuery.isLoading) return;
    const mapped = mapApiPolicyToUi(policyQuery.data);
    if (mapped?.length) {
      setLeaveTypes(mapped);
      hydrated.current = true;
    } else if (policyQuery.isFetched) {
      setLeaveTypes(storePolicy.leaveTypes?.length ? storePolicy.leaveTypes : []);
      hydrated.current = true;
    }
  }, [policyQuery.data, policyQuery.isLoading, policyQuery.isFetched, storePolicy.leaveTypes]);

  // Meta (approval / accrual) arrives via bootstrap into the store
  useEffect(() => {
    setForm({
      approvalLevel: storePolicy.approvalLevel || 'single',
      accrualMethod: storePolicy.accrualMethod || 'upfront',
      autoDeduct: Boolean(storePolicy.autoDeduct),
    });
  }, [storePolicy.approvalLevel, storePolicy.accrualMethod, storePolicy.autoDeduct]);

  useEffect(() => {
    if (Array.isArray(holidaysQuery.data)) setHolidays(holidaysQuery.data);
  }, [holidaysQuery.data]);

  const usedCodes = leaveTypes.map((t) => t.code).filter(Boolean);

  const patchType = (id, patch) => {
    setLeaveTypes((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleAddType = (lt) => {
    setLeaveTypes((prev) => [
      ...prev,
      {
        id: `LT-${lt.code}-${Date.now()}`,
        code: lt.code,
        name: lt.name,
        daysPerYear: lt.daysPerYear,
        carryForward: lt.carryForward,
        maxCarry: lt.maxCarry,
        encashment: lt.encashment,
        paid: lt.paid,
        active: lt.active !== false,
      },
    ]);
    toast.success('Leave type added — click Save Changes to sync');
  };

  const handleRemoveType = (id) => {
    setLeaveTypes((prev) => prev.filter((l) => l.id !== id));
  };

  const save = async () => {
    if (!leaveTypes.length) return toast.error('Add at least one leave type');
    const missingCode = leaveTypes.find((t) => !t.code);
    if (missingCode) return toast.error(`Leave type "${missingCode.name}" needs a code`);
    const invalid = leaveTypes.find((t) => !ALLOWED_LEAVE_CODES.includes(String(t.code).toUpperCase()));
    if (invalid) {
      return toast.error(
        `Invalid code "${invalid.code}". Allowed: ${ALLOWED_LEAVE_CODES.join(', ')}`
      );
    }

    setSaving(true);
    try {
      const policy = leaveTypes.map((t) => ({
        code: String(t.code).trim().toUpperCase(),
        name: t.name,
        allocation: Number(t.daysPerYear) || 0,
        active: t.active !== false,
        carry_forward: Boolean(t.carryForward),
        max_carry: Number(t.maxCarry) || 0,
        encashment: Boolean(t.encashment),
        paid: t.paid !== false,
      }));

      await updateLeavePolicyApi(policy);
      await updateSettingApi('leave_policy_meta', {
        approval_level: form.approvalLevel,
        accrual_method: form.accrualMethod,
        auto_deduct: form.autoDeduct,
      });

      // Sync store once after successful save (not on every keystroke)
      syncStore({
        leaveTypes: leaveTypes.map((t) => ({ ...t, code: String(t.code).trim().toUpperCase() })),
        approvalLevel: form.approvalLevel,
        accrualMethod: form.accrualMethod,
        autoDeduct: form.autoDeduct,
        holidays,
      });

      await invalidateAndRefetch(qc, ['settings', 'leave-policy']);
      await invalidateAndRefetch(qc, ['leaves']);

      // Push new allocations to all employees immediately after save
      await applyLeavePolicyApi(year);

      toast.success(`Leave policy saved and applied to all employees for ${year}`);
    } catch (err) {
      toast.error(err.message || 'Failed to save leave policy');
    } finally {
      setSaving(false);
    }
  };

  const applyToAll = async () => {
    setApplying(true);
    try {
      await applyLeavePolicyApi(year);
      await invalidateAndRefetch(qc, ['leaves']);
      toast.success(`Leave allocations applied to all employees for ${year}`);
    } catch (err) {
      toast.error(err.message || 'Failed to apply leave policy');
    } finally {
      setApplying(false);
    }
  };

  const removeHoliday = async (id) => {
    try {
      await deleteHolidayApi(id);
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      await invalidateAndRefetch(qc, ['holidays']);
      toast.success('Holiday removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove holiday');
    }
  };

  const loading = policyQuery.isLoading || holidaysQuery.isLoading;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Leave Types"
          subtitle="Edit days locally (instant). Save, then Apply to push allocations to employees."
          action={<Button size="sm" icon={Plus} onClick={() => setLtModal(true)}>Add Leave Type</Button>}
        />
        <div className="p-5 pt-3 overflow-x-auto">
          {loading && !leaveTypes.length ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Code', 'Leave Type', 'Days/Year', 'Active', 'Paid', 'Carry Fwd', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaveTypes.map((lt) => (
                  <tr key={lt.id} className="border-b border-border/50">
                    <td className="py-2.5 font-mono text-xs text-fg-muted">{lt.code}</td>
                    <td className="py-2.5 text-fg font-medium">{lt.name}</td>
                    <td className="py-2.5 w-28">
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={lt.daysPerYear ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          patchType(lt.id, { daysPerYear: raw === '' ? '' : Math.max(0, Number(raw) || 0) });
                        }}
                        className="h-9 w-20 rounded-input border border-border bg-card px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </td>
                    <td className="py-2.5">
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={lt.active !== false} onChange={(e) => patchType(lt.id, { active: e.target.checked })} />
                    </td>
                    <td className="py-2.5 text-fg-muted">{lt.paid ? 'Yes' : 'No'}</td>
                    <td className="py-2.5 text-fg-muted">{lt.carryForward ? `Yes (${lt.maxCarry || 0})` : 'No'}</td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => handleRemoveType(lt.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${lt.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Approval Flow"
          subtitle="Single-level: manager approval finalizes leave. Two-level: manager approves first, then HR must approve."
        />
        <div className="p-5 pt-3 space-y-2.5">
          {[['single', 'Single-level: Manager only'], ['two-level', 'Two-level: Manager → HR']].map(([val, label]) => (
            <label key={val} className="flex items-center gap-2.5 text-sm text-fg cursor-pointer">
              <input type="radio" name="approvalLevel" className="h-4 w-4 accent-primary" checked={form.approvalLevel === val} onChange={() => setForm({ ...form, approvalLevel: val })} />
              {label}
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Leave Accrual" />
        <div className="p-5 pt-3 space-y-2.5">
          {[['upfront', 'Upfront — full balance at year start'], ['monthly', 'Monthly — credit each month'], ['quarterly', 'Quarterly']].map(([val, label]) => (
            <label key={val} className="flex items-center gap-2.5 text-sm text-fg cursor-pointer">
              <input type="radio" name="accrualMethod" className="h-4 w-4 accent-primary" checked={form.accrualMethod === val} onChange={() => setForm({ ...form, accrualMethod: val })} />
              {label}
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <Toggle label="Auto-deduct casual leave for unplanned absence" checked={form.autoDeduct} onChange={(v) => setForm({ ...form, autoDeduct: v })} />
      </Card>

      <Card>
        <CardHeader
          title={`Holiday List · ${year}`}
          subtitle="Synced with Holiday Calendar for all employees"
          action={<Button size="sm" icon={Plus} onClick={() => setHolModal(true)}>Add Holiday</Button>}
        />
        <div className="p-5 pt-3 overflow-x-auto">
          {holidaysQuery.isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : holidays.length === 0 ? (
            <p className="text-sm text-fg-subtle py-2">No holidays for {year}. Add national / optional holidays above.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Date</th>
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Holiday Name</th>
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Type</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id} className="border-b border-border/50">
                    <td className="py-2.5 text-fg-muted">{formatDate(h.date, 'dd MMM yyyy')}</td>
                    <td className="py-2.5 text-fg font-medium">{h.name}</td>
                    <td className="py-2.5 text-fg-muted capitalize">{h.type}</td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => removeHoliday(h.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-card/95 backdrop-blur px-3 py-3 rounded-xl">
        <Button variant="outline" icon={RefreshCw} onClick={applyToAll} loading={applying}>
          Apply allocations to all ({year})
        </Button>
        <Button icon={Save} onClick={save} loading={saving}>Save Changes</Button>
      </div>

      <AddLeaveTypeModal open={ltModal} onClose={() => setLtModal(false)} onAdd={handleAddType} usedCodes={usedCodes} />
      <AddHolidayModal
        open={holModal}
        onClose={() => setHolModal(false)}
        onCreated={(row) => {
          setHolidays((prev) => [...prev, row].sort((a, b) => String(a.date).localeCompare(String(b.date))));
          invalidateAndRefetch(qc, ['holidays']);
        }}
      />
    </div>
  );
}
