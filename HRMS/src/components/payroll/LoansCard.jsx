import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Skeleton } from '../ui';
import { fetchLoansApi, createLoanApi, cancelLoanApi } from '../../api/payroll.api';
import { cn, formatCurrency } from '../../lib/utils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inputClass = 'h-9 w-full rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary';

/** Next month as the default start of recovery. */
const nextMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

/**
 * Employee → Payroll: loans and salary advances recovered through payroll.
 * Each published payslip recovers the monthly instalment (or what is left);
 * a loan entered by mistake can be cancelled before anything is recovered.
 */
export function LoansCard({ employeeId, employeeName, canEdit }) {
  const qc = useQueryClient();
  const key = ['payroll', 'loans', employeeId];
  const { data: loans = [], isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => fetchLoansApi(employeeId),
    enabled: Boolean(employeeId),
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);
  const start = nextMonth();
  const [form, setForm] = useState({
    kind: 'loan', principal: '', instalment: '', startMonth: start.month, startYear: start.year, note: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const invalid = !(Number(form.principal) > 0) || !(Number(form.instalment) > 0) || Number(form.instalment) > Number(form.principal);

  const add = async () => {
    setBusy('add');
    try {
      await createLoanApi(employeeId, {
        kind: form.kind,
        principal: Number(form.principal),
        instalment: Number(form.instalment),
        startMonth: Number(form.startMonth),
        startYear: Number(form.startYear),
        note: form.note,
      });
      toast.success(`${form.kind === 'advance' ? 'Advance' : 'Loan'} recorded — payroll recovers it from ${MONTHS[form.startMonth - 1]} ${form.startYear}`);
      setAdding(false);
      setForm((f) => ({ ...f, principal: '', instalment: '', note: '' }));
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err.message || 'Could not record it');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (loan) => {
    setBusy(loan.id);
    try {
      await cancelLoanApi(employeeId, loan.id);
      toast.success('Cancelled');
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(err.message || 'Could not cancel it');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HandCoins className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-fg">Loans and salary advances</h3>
        </div>
        {canEdit && !adding && !error && (
          <Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding(true)}>Add</Button>
        )}
      </div>
      <p className="mt-1 text-xs text-fg-subtle">Recovered from {employeeName || 'their'} pay each month until paid back.</p>

      {error && <p className="mt-3 text-sm text-fg-muted">{error.message}</p>}
      {isLoading && <Skeleton className="mt-3 h-16 rounded-xl" />}

      {!isLoading && !error && loans.length === 0 && !adding && (
        <p className="mt-3 text-sm text-fg-subtle">None.</p>
      )}

      {loans.length > 0 && (
        <div className="mt-3 space-y-2">
          {loans.map((l) => (
            <div key={l.id} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm', l.status === 'active' ? 'border-border' : 'border-border/50 opacity-70')}>
              <div>
                <p className="font-semibold text-fg">
                  {l.kind === 'advance' ? 'Salary advance' : 'Loan'} of {formatCurrency(l.principal)}
                  <span className="ml-2 text-xs font-normal text-fg-subtle">{formatCurrency(l.instalment)} a month from {MONTHS[l.startMonth - 1]} {l.startYear}</span>
                </p>
                <p className="text-xs text-fg-muted">
                  Recovered {formatCurrency(l.recovered)} · left {formatCurrency(l.remaining)} · {l.status === 'active' ? 'active' : l.status}
                  {l.note ? ` · ${l.note}` : ''}
                </p>
              </div>
              {canEdit && l.status === 'active' && Number(l.recovered) === 0 && (
                <Button size="sm" variant="ghost" loading={busy === l.id} onClick={() => cancel(l)}>Cancel</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Kind</span>
            <select value={form.kind} onChange={set('kind')} className={inputClass}>
              <option value="loan">Loan</option>
              <option value="advance">Salary advance</option>
            </select>
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Amount (₹)</span>
            <input type="number" min={1} value={form.principal} onChange={set('principal')} className={inputClass} />
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Recover each month (₹)</span>
            <input type="number" min={1} value={form.instalment} onChange={set('instalment')} className={inputClass} />
          </label>
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">From the payslip of</span>
            <div className="flex gap-2">
              <select value={form.startMonth} onChange={set('startMonth')} className={inputClass}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" min={2000} max={2100} value={form.startYear} onChange={set('startYear')} className={inputClass} aria-label="Year" />
            </div>
          </label>
          <label className="text-xs text-fg-muted sm:col-span-2">
            <span className="mb-1 block font-semibold text-fg">Note (optional)</span>
            <input value={form.note} maxLength={500} onChange={set('note')} className={inputClass} />
          </label>
          {Number(form.instalment) > Number(form.principal) && (
            <p className="text-xs font-semibold text-danger sm:col-span-2">The monthly amount can&apos;t be more than the loan.</p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={busy === 'add'}>Cancel</Button>
            <Button size="sm" onClick={add} loading={busy === 'add'} disabled={invalid}>Save</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
