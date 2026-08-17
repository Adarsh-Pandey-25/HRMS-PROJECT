import { useEffect, useState } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, Input, Select, Toggle, Button } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateSettingApi } from '../../api/settings.api';
import { recalculatePayslipsFromSettingsApi } from '../../api/payroll.api';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { DEFAULT_SALARY_COMPONENTS } from '../../lib/payrollComponents';

const COMPONENT_LABELS = {
  hra: ['HRA', '% of Basic'],
  da: ['DA', '% of Basic'],
  special: ['Special Allowance', ''],
  transport: ['Transport Allowance', ''],
  medical: ['Medical Allowance', ''],
};

const KIND_OPTIONS = [
  { value: 'deduction', label: 'Deduction' },
  { value: 'allowance', label: 'Allowance' },
];

const VALUE_TYPE_OPTIONS = [
  { value: 'fixed', label: 'Fixed amount (₹)' },
  { value: 'percent', label: '% of Basic / Gross' },
];

const BASE_OPTIONS = [
  { value: 'basic', label: 'Basic salary' },
  { value: 'gross', label: 'Gross salary' },
];

function newCustomOption() {
  return {
    id: `PO-${Date.now()}`,
    name: '',
    kind: 'deduction',
    valueType: 'fixed',
    value: 0,
    base: 'basic',
    active: true,
  };
}

export function PayrollSettingsSection() {
  const queryClient = useQueryClient();
  const cfg = useSettingsStore((s) => s.payrollConfig);
  const update = useSettingsStore((s) => s.updatePayrollConfig);
  const [form, setForm] = useState({
    ...cfg,
    professionalTaxAmount: cfg.professionalTaxAmount ?? 200,
    tdsPercent: cfg.tdsPercent ?? 8,
    customPayrollOptions: cfg.customPayrollOptions || [],
  });
  const [saving, setSaving] = useState(false);

  // Rehydrate after bootstrap loads payroll settings from server
  useEffect(() => {
    setForm({
      ...cfg,
      professionalTaxAmount: cfg.professionalTaxAmount ?? 200,
      tdsPercent: cfg.tdsPercent ?? 8,
      customPayrollOptions: cfg.customPayrollOptions || [],
    });
  }, [cfg]);

  const customOptions = form.customPayrollOptions || [];

  const patchOption = (id, patch) => {
    setForm((s) => ({
      ...s,
      customPayrollOptions: (s.customPayrollOptions || []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  };

  const addOption = () => {
    setForm((s) => ({ ...s, customPayrollOptions: [...(s.customPayrollOptions || []), newCustomOption()] }));
  };

  const removeOption = (id) => {
    setForm((s) => ({ ...s, customPayrollOptions: (s.customPayrollOptions || []).filter((o) => o.id !== id) }));
  };

  const save = async () => {
    update(form);
    setSaving(true);
    try {
      await Promise.all([
        updateSettingApi('payroll_working_days', form.workingDaysPerMonth ?? 26),
        updateSettingApi('payroll_pf_rate', (form.pfEmployeePercent ?? 12) / 100),
        updateSettingApi('payroll_professional_tax', form.professionalTaxAmount ?? 200),
        updateSettingApi('payroll_tds_percent', form.tdsPercent ?? 8),
        updateSettingApi('payroll_config', {
          pf_employee_percent: form.pfEmployeePercent ?? 12,
          professional_tax_amount: form.professionalTaxAmount ?? 200,
          tds_percent: form.tdsPercent ?? 8,
          tds_mode: form.tdsMode ?? 'auto',
          pt_state: form.ptState ?? 'Karnataka',
          pf_wage_ceiling: form.pfWageCeiling ?? null,
          components: form.components || DEFAULT_SALARY_COMPONENTS,
          hra_percent: form.hraPercent ?? 40,
          da_percent: form.daPercent ?? 10,
          run_date: Number(form.runDate) || 25,
          auto_process: Boolean(form.autoProcess),
          auto_lock_days: Number(form.autoLockDays) || 20,
          bank_file_format: form.bankFileFormat || 'NEFT',
          custom_payroll_options: (form.customPayrollOptions || []).map((o) => ({
            id: o.id,
            name: o.name,
            kind: o.kind,
            value_type: o.valueType,
            value: o.value,
            base: o.base,
            active: o.active !== false,
          })),
        }),
      ]);
      let recalcMsg = '';
      try {
        const result = await recalculatePayslipsFromSettingsApi();
        const n = result?.updated ?? 0;
        recalcMsg = n > 0 ? ` · ${n} payslip${n === 1 ? '' : 's'} updated` : '';
        await invalidateAndRefetch(queryClient, ['payroll']);
        await invalidateAndRefetch(queryClient, ['settings']);
        toast.success(`Payroll settings saved${recalcMsg}`);
      } catch (recalcErr) {
        await invalidateAndRefetch(queryClient, ['settings']);
        toast.success('Payroll settings saved');
        toast.error(
          recalcErr.message?.includes('timeout')
            ? 'Payslip refresh is still running in the background — check Run Payroll in a minute'
            : (recalcErr.message || 'Payslip refresh failed; settings were still saved'),
        );
      }
    } catch (err) {
      toast.error(err.message || 'Saved locally but server sync failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Salary Components" subtitle="Toggle which components are active" />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Basic Salary" hint="Always on" checked disabled />
          {Object.entries(COMPONENT_LABELS).map(([key, [label]]) => (
            <Toggle key={key} label={label} checked={form.components[key]} onChange={(v) => setForm({ ...form, components: { ...form.components, [key]: v } })} />
          ))}
          {(form.components?.hra || form.components?.da) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {form.components?.hra && (
                <Input label="HRA % of Basic" type="number" value={form.hraPercent} onChange={(e) => setForm({ ...form, hraPercent: Number(e.target.value) })} />
              )}
              {form.components?.da && (
                <Input label="DA % of Basic" type="number" value={form.daPercent} onChange={(e) => setForm({ ...form, daPercent: Number(e.target.value) })} />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="PF, PT & TDS"
          subtitle="Saving updates current & open-month payslips immediately (and salary preview)"
        />
        <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="PF (Employee) %"
            type="number"
            min={0}
            value={form.pfEmployeePercent}
            onChange={(e) => setForm({ ...form, pfEmployeePercent: Number(e.target.value) })}
            hint="% of Basic — shown as editable PF on employee salary"
          />
          <Input
            label="Professional Tax (₹ / month)"
            type="number"
            min={0}
            value={form.professionalTaxAmount ?? 200}
            onChange={(e) => setForm({ ...form, professionalTaxAmount: Number(e.target.value) })}
            hint="Flat monthly PT amount"
          />
          <Input
            label="TDS estimate (% of Gross)"
            type="number"
            min={0}
            step="0.1"
            value={form.tdsPercent ?? 8}
            onChange={(e) => setForm({ ...form, tdsPercent: Number(e.target.value) })}
            hint="Used to suggest TDS on employee salary"
          />
          <Select label="TDS mode" options={[{ value: 'auto', label: 'Auto-calculate' }, { value: 'manual', label: 'Manual entry' }]} value={form.tdsMode} onChange={(e) => setForm({ ...form, tdsMode: e.target.value })} />
          <Select label="Professional Tax — State" options={['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Delhi', 'Telangana']} value={form.ptState} onChange={(e) => setForm({ ...form, ptState: e.target.value })} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Additional payroll options"
          subtitle="Add custom allowances or deductions — they appear on employee salary forms"
          action={<Button size="sm" icon={Plus} onClick={addOption}>Add</Button>}
        />
        <div className="p-5 pt-3 space-y-3">
          {customOptions.length === 0 ? (
            <p className="text-sm text-fg-subtle py-2">No extra options yet. Click Add to create e.g. Insurance, Meal voucher, LWF.</p>
          ) : customOptions.map((opt) => (
            <div key={opt.id} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end rounded-xl border border-border/60 p-4">
              <Input
                label="Name"
                containerClass="sm:col-span-3"
                value={opt.name}
                placeholder="e.g. Insurance"
                onChange={(e) => patchOption(opt.id, { name: e.target.value })}
              />
              <Select
                label="Type"
                containerClass="sm:col-span-2"
                options={KIND_OPTIONS}
                value={opt.kind}
                onChange={(e) => patchOption(opt.id, { kind: e.target.value })}
              />
              <Select
                label="Value type"
                containerClass="sm:col-span-2"
                options={VALUE_TYPE_OPTIONS}
                value={opt.valueType}
                onChange={(e) => patchOption(opt.id, { valueType: e.target.value })}
              />
              {opt.valueType === 'percent' && (
                <Select
                  label="Base"
                  containerClass="sm:col-span-2"
                  options={BASE_OPTIONS}
                  value={opt.base}
                  onChange={(e) => patchOption(opt.id, { base: e.target.value })}
                />
              )}
              <Input
                label={opt.valueType === 'percent' ? 'Percent' : 'Amount (₹)'}
                type="number"
                min={0}
                containerClass={opt.valueType === 'percent' ? 'sm:col-span-2' : 'sm:col-span-4'}
                value={opt.value}
                onChange={(e) => patchOption(opt.id, { value: Number(e.target.value) })}
              />
              <div className="sm:col-span-1 flex items-center justify-end pb-1">
                <button
                  type="button"
                  onClick={() => removeOption(opt.id)}
                  className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  aria-label={`Remove ${opt.name || 'option'}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Payroll Run" />
        <div className="p-5 pt-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Working days / month" type="number" min={1} max={31} value={form.workingDaysPerMonth ?? 26} onChange={(e) => setForm({ ...form, workingDaysPerMonth: Number(e.target.value) })} />
            <Input label="Payroll run date (day of month)" type="number" min={1} max={28} value={form.runDate} onChange={(e) => setForm({ ...form, runDate: Number(e.target.value) })} />
            <Input label="Auto-lock attendance (days after month end)" type="number" value={form.autoLockDays} onChange={(e) => setForm({ ...form, autoLockDays: Number(e.target.value) })} />
            <Select label="Bank file format" options={['NEFT', 'RTGS', 'Bank-specific']} value={form.bankFileFormat} onChange={(e) => setForm({ ...form, bankFileFormat: e.target.value })} />
          </div>
          <Toggle
            label="Auto-process payroll"
            hint="If on, draft payslips for the current month are generated automatically on the run date (server cron)."
            checked={form.autoProcess}
            onChange={(v) => setForm({ ...form, autoProcess: v })}
          />
        </div>
        <div className="px-5 pb-5 flex justify-end">
          <Button icon={Save} onClick={save} loading={saving}>Save Changes</Button>
        </div>
      </Card>
    </div>
  );
}
