import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Skeleton } from '../ui';
import { fetchOneTimePayApi, createOneTimePayApi, cancelOneTimePayApi } from '../../api/payroll.api';
import { cn, formatCurrency } from '../../lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputClass = 'h-9 w-full rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary';

/** Each kind and what it counts for by default (the server keeps the same defaults). */
const KINDS = [
  { value: 'arrears', label: 'Arrears', earning: true, taxable: true, pfWage: true, esiWage: true },
  { value: 'bonus', label: 'Bonus', earning: true, taxable: true, pfWage: false, esiWage: false },
  { value: 'incentive', label: 'Incentive', earning: true, taxable: true, pfWage: false, esiWage: true },
  { value: 'leave_encashment', label: 'Leave encashment', earning: true, taxable: true, pfWage: false, esiWage: false },
  { value: 'gratuity', label: 'Gratuity', earning: true, taxable: true, pfWage: false, esiWage: false },
  { value: 'notice_pay', label: 'Pay in lieu of notice', earning: true, taxable: true, pfWage: false, esiWage: false },
  { value: 'other_earning', label: 'Other earning', earning: true, taxable: true, pfWage: false, esiWage: false },
  { value: 'notice_recovery', label: 'Notice period not served (recovery)', earning: false },
  { value: 'other_deduction', label: 'Other recovery', earning: false },
];
const kindOf = (v) => KINDS.find((k) => k.value === v) || KINDS[0];

/** The month just ended: payroll runs after the month is over. */
const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

/**
 * Employee → Payroll: one-time pay and recoveries for a month's payslip —
 * arrears, bonus, incentives, leave encashment, gratuity, notice pay. The
 * month's draft payslip includes them (published ones never change); the
 * income tax on them is worked out by the difference method.
 */
export function OneTimePayCard({ employeeId, employeeName, canEdit }) {
  const qc = useQueryClient();
  const key = ['payroll', 'one-time', employeeId];
  const { data: items = [], isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => fetchOneTimePayApi(employeeId),
    enabled: Boolean(employeeId),
    retry: false,
  });
  const start = lastMonth();
  const blank = {
    kind: 'arrears', name: '', amount: '', month: start.month, year: start.year, taxable: true, pfWage: true, esiWage: true, note: '',
  };
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(blank);
  const def = kindOf(form.kind);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setKind = (e) => {
    const k = kindOf(e.target.value);
    setForm((f) => ({
      ...f, kind: k.value, taxable: Boolean(k.taxable), pfWage: Boolean(k.pfWage), esiWage: Boolean(k.esiWage),
    }));
  };
  const invalid = !(Number(form.amount) > 0);
  const active = useMemo(() => items.filter((i) => i.status === 'active'), [items]);

  const add = async () => {
    setBusy('add');
    try {
      await createOneTimePayApi(employeeId, {
        kind: form.kind,
        name: form.name,
        amount: Number(form.amount),
        month: Number(form.month),
        year: Number(form.year),
        taxable: def.earning ? form.taxable : false,
        pfWage: def.earning ? form.pfWage : false,
        esiWage: def.earning ? form.esiWage : false,
        note: form.note,
      });
      toast.success(`Added to the ${MONTHS[form.month - 1]} ${form.year} payslip`);
      setAdding(false);
      setForm(blank);
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err.message || 'Could not add it');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (item) => {
    setBusy(item.id);
    try {
      await cancelOneTimePayApi(employeeId, item.id);
      toast.success('Removed');
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err.message || 'Could not remove it');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-fg">One-time pay and recoveries</h3>
        </div>
        {canEdit && !adding && !error && (
          <Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding(true)}>Add</Button>
        )}
      </div>
      <p className="mt-1 text-xs text-fg-subtle">
        Arrears, bonus, incentives and other one-time pay for {employeeName || 'this person'}, added to a month&apos;s payslip.
      </p>

      {error && <p className="mt-3 text-sm text-fg-muted">{error.message}</p>}
      {isLoading && <Skeleton className="mt-3 h-16 rounded-xl" />}
      {!isLoading && !error && items.length === 0 && !adding && <p className="mt-3 text-sm text-fg-subtle">None.</p>}

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          {items.map((i) => (
            <div key={i.id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm', i.status === 'active' ? 'border-border' : 'border-border/50 opacity-60')}>
              <div>
                <p className="font-semibold text-fg">
                  {i.name}
                  <span className={cn('ml-2', i.earning ? 'text-success' : 'text-danger')}>{i.earning ? '+' : '−'}{formatCurrency(i.amount)}</span>
                </p>
                <p className="text-xs text-fg-muted">
                  {MONTHS[i.month - 1]} {i.year} payslip
                  {i.earning ? ` · ${i.taxable ? 'taxable' : 'not taxable'}${i.pfWage ? ' · PF' : ''}${i.esiWage ? ' · ESI' : ''}` : ''}
                  {i.source === 'fnf' ? ' · full and final' : ''}
                  {i.status !== 'active' ? ' · removed' : ''}
                  {i.note ? ` · ${i.note}` : ''}
                </p>
              </div>
              {canEdit && i.status === 'active' && (
                <Button size="sm" variant="ghost" loading={busy === i.id} disabled={Boolean(busy)} onClick={() => cancel(i)}>Remove</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">What it is</span>
            <select value={form.kind} onChange={setKind} className={inputClass}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Amount (₹)</span>
            <input type="number" min={1} value={form.amount} onChange={set('amount')} className={inputClass} />
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">On the payslip of</span>
            <div className="flex gap-2">
              <select value={form.month} onChange={set('month')} className={inputClass}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" min={2000} max={2100} value={form.year} onChange={set('year')} className={inputClass} aria-label="Year" />
            </div>
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Shown on the payslip as (optional)</span>
            <input value={form.name} maxLength={80} placeholder={def.label} onChange={set('name')} className={inputClass} />
          </label>
          {def.earning && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.taxable} onChange={set('taxable')} />Taxable</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.pfWage} onChange={set('pfWage')} />Counts for PF (arrears of Basic + DA)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.esiWage} onChange={set('esiWage')} />Counts for ESI</label>
            </div>
          )}
          <label className="text-xs text-fg-muted sm:col-span-2">
            <span className="mb-1 block font-semibold text-fg">Note (optional)</span>
            <input value={form.note} maxLength={500} onChange={set('note')} className={inputClass} />
          </label>
          <p className="text-[11px] text-fg-subtle sm:col-span-2">
            {def.earning
              ? 'Paid in full that month, not by days worked. The extra income tax it causes is deducted that month (the difference method).'
              : 'Recovered after the other deductions, never more than the pay left; what can\'t be recovered is shown on the payslip.'}
          </p>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy === 'add'}>Cancel</Button>
            {/* Disabled while saving: a second click must not add the item twice. */}
            <Button size="sm" onClick={add} loading={busy === 'add'} disabled={invalid || Boolean(busy)}>Save</Button>
          </div>
        </div>
      )}
      {active.length > 0 && <p className="mt-2 text-[11px] text-fg-subtle">Draft payslips for those months are updated on their own.</p>}
    </Card>
  );
}
