import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Calculator, FileCheck2, Scale } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card } from '../ui';
import { applyFullAndFinalApi, generateFinalPayslipApi, previewFullAndFinalApi } from '../../api/payroll.api';
import { cn, formatCurrency, formatDate } from '../../lib/utils';

const inputClass = 'h-9 w-full rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary';

/**
 * Employee → Payroll, for someone who has left: the full and final
 * settlement — gratuity, leave encashment, notice pay and the statutory
 * bonus so far — worked out with the company's own values, added to the
 * final payslip as one-time pay, and the final payslip made as soon as the
 * last working day is over (final dues within 2 working days).
 */
export function FullAndFinalCard({ employeeId, employeeName, canEdit }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    leaveDays: 0, noticeAction: 'none', requiredDays: 30, servedDays: 30, noticeBase: 'gross', divisor: 30, fixedTerm: false, includeBonus: true,
  });
  const [result, setResult] = useState(null);
  // The inputs the shown result was worked out with: "Add" sends exactly those.
  const [previewed, setPreviewed] = useState(null);
  const [busy, setBusy] = useState(null);
  // A change after working it out needs working out again before it is added.
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    setResult(null);
    setPreviewed(null);
  };
  const inputs = () => ({
    leaveDays: Number(form.leaveDays) || 0,
    fixedTerm: Boolean(form.fixedTerm),
    includeBonus: Boolean(form.includeBonus),
    notice: form.noticeAction === 'none' ? null : {
      action: form.noticeAction,
      requiredDays: Number(form.requiredDays) || 0,
      servedDays: Number(form.servedDays) || 0,
      base: form.noticeBase,
      divisor: Number(form.divisor) || 30,
    },
  });

  const run = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'preview') {
        const used = inputs();
        setResult(await previewFullAndFinalApi(employeeId, used));
        setPreviewed(used);
      } else if (kind === 'apply') {
        const r = await applyFullAndFinalApi(employeeId, previewed);
        setResult(r);
        toast.success(`Added to the ${formatDate(`${r.year}-${String(r.month).padStart(2, '0')}-01`, 'MMMM yyyy')} payslip`);
        await qc.invalidateQueries({ queryKey: ['payroll', 'one-time', employeeId] });
      } else {
        await generateFinalPayslipApi(employeeId);
        toast.success('Final payslip drafted — review and publish it on Run Payroll');
        await qc.invalidateQueries({ queryKey: ['payroll'] });
      }
    } catch (err) {
      toast.error(err.message || 'Could not do that');
    } finally {
      setBusy(null);
    }
  };

  const total = (result?.items || []).reduce((s, i) => s + (i.earning ? 1 : -1) * Math.round(Number(i.amount) * 100), 0) / 100;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Scale className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-fg">Full and final settlement</h3>
      </div>
      <p className="mt-1 text-xs text-fg-subtle">
        For {employeeName || 'this person'}&apos;s last payslip: gratuity, leave encashment, notice pay and the statutory bonus so far. Final dues are payable within 2 working days of leaving.
      </p>

      {canEdit && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Leave days to encash</span>
            <input type="number" min={0} step={0.5} value={form.leaveDays} onChange={set('leaveDays')} className={inputClass} />
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Notice period</span>
            <select value={form.noticeAction} onChange={set('noticeAction')} className={inputClass}>
              <option value="none">Served in full, or waived</option>
              <option value="recover">Not served in full: recover the days short</option>
              <option value="pay">Relieved early: pay the days short</option>
            </select>
          </label>
          {form.noticeAction !== 'none' && (
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4">
              <label className="text-xs text-fg-muted">
                <span className="mb-1 block font-semibold text-fg">Days required</span>
                <input type="number" min={0} max={365} value={form.requiredDays} onChange={set('requiredDays')} className={inputClass} />
              </label>
              <label className="text-xs text-fg-muted">
                <span className="mb-1 block font-semibold text-fg">Days served</span>
                <input type="number" min={0} max={365} value={form.servedDays} onChange={set('servedDays')} className={inputClass} />
              </label>
              <label className="text-xs text-fg-muted">
                <span className="mb-1 block font-semibold text-fg">A day&apos;s pay from</span>
                <select value={form.noticeBase} onChange={set('noticeBase')} className={inputClass}>
                  <option value="gross">Gross</option>
                  <option value="basic_da">Basic + DA</option>
                </select>
              </label>
              <label className="text-xs text-fg-muted">
                <span className="mb-1 block font-semibold text-fg">÷ days</span>
                <input type="number" min={1} max={31} value={form.divisor} onChange={set('divisor')} className={inputClass} />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted sm:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.includeBonus} onChange={set('includeBonus')} />Statutory bonus for this year so far</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.fixedTerm} onChange={set('fixedTerm')} />Fixed-term employee (gratuity after 1 year)</label>
          </div>
          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="outline" icon={Calculator} loading={busy === 'preview'} disabled={Boolean(busy)} onClick={() => run('preview')}>Work it out</Button>
            <Button size="sm" loading={busy === 'apply'} disabled={!result || !previewed || Boolean(busy)} onClick={() => run('apply')}>Add to the final payslip</Button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-fg-muted">
            Last working day {formatDate(result.lastWorkingDay, 'dd MMM yyyy')} · last drawn {formatCurrency(result.monthly?.gross)} a month (wages {formatCurrency(result.monthly?.wages)})
            {result.settlementPayslip && ` · their last month is already published, so this goes on a settlement payslip for ${formatDate(`${result.year}-${String(result.month).padStart(2, '0')}-01`, 'MMMM yyyy')}`}
          </p>
          {result.items.length === 0 && <p className="text-sm text-fg-subtle">Nothing to pay or recover besides the month&apos;s pay.</p>}
          {result.items.map((i) => (
            <div key={i.code} className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm">
              <span className="font-semibold text-fg">{i.name}</span>
              <span className={cn('font-semibold tabular-nums', i.earning ? 'text-success' : 'text-danger')}>{i.earning ? '+' : '−'}{formatCurrency(i.amount)}</span>
            </div>
          ))}
          {result.items.length > 0 && (
            <p className="text-right text-xs font-semibold text-fg">Settlement besides the month&apos;s pay: {formatCurrency(total)}</p>
          )}
          {(result.notes || []).map((n) => <p key={n} className="text-[11px] text-fg-subtle">{n}</p>)}
          {(result.leaveBalances || []).length > 0 && (
            <p className="text-[11px] text-fg-subtle">Leave left this year: {result.leaveBalances.map((b) => `${b.type} ${b.available}`).join(' · ')}</p>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                icon={FileCheck2}
                loading={busy === 'generate'}
                disabled={!result.canGenerate || Boolean(busy)}
                title={result.canGenerate ? undefined : 'From the day after the last working day'}
                onClick={() => run('generate')}
              >
                Make the final payslip
              </Button>
            </div>
          )}
          <p className="text-[11px] text-fg-subtle">
            Income tax on the settlement is worked out by the difference method. Gratuity and leave encashment are taxed in full until your CA confirms their exemptions.
          </p>
        </div>
      )}
    </Card>
  );
}
