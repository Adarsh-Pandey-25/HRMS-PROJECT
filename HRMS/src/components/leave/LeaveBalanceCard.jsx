import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Pencil, RotateCcw, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Skeleton } from '../ui';
import { useLeaveBalance } from '../../hooks/useLeaves';
import { updateLeaveBalanceApi } from '../../api/leaves.api';

const fmt = (n) => {
  const v = Math.round(Number(n || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * An employee's leave balance for the year, and — for HR/Admin — the place
 * to set their allocation individually. The first individual allocation is
 * setup and emails nobody; later changes email the employee and the
 * company's admins (server: leave.service.js setEmployeeAllocations).
 */
export function LeaveBalanceCard({ employeeId, employeeName, canEdit = false }) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const { data, isLoading } = useLeaveBalance(employeeId);
  const items = data?.items || [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(Object.fromEntries(items.map((b) => [b.code, { value: fmt(b.total), reset: false }])));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = items.filter((b) => {
    const d = draft[b.code];
    if (!d) return false;
    if (d.reset) return b.custom;
    return d.value !== '' && Number(d.value) !== b.total;
  });
  const invalid = items.filter((b) => {
    const d = draft[b.code];
    if (!d || d.reset) return false;
    const n = Number(d.value);
    return d.value === '' || !Number.isFinite(n) || n < 0 || n > 366 || Math.round(n * 2) !== n * 2;
  });

  const save = async () => {
    setSaving(true);
    try {
      const allocations = Object.fromEntries(changed.map((b) => [b.code, draft[b.code].reset ? null : Number(draft[b.code].value)]));
      const result = await updateLeaveBalanceApi(employeeId, { year, allocations });
      qc.setQueryData(['leaves', 'balance', employeeId, year], result.balance);
      await qc.invalidateQueries({ queryKey: ['leaves'] });
      toast.success(result.notified
        ? `Leave balance updated — ${employeeName || 'the employee'} and your admins were emailed`
        : 'Leave balance set');
      setOpen(false);
    } catch (err) {
      toast.error(err.message || 'Could not update the leave balance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={`Leave Balance · ${year}`}
        subtitle="Allocated, used and available days per leave type"
        action={canEdit && items.length > 0 && (
          <Button size="sm" variant="outline" icon={Pencil} onClick={() => setOpen(true)}>Edit allocation</Button>
        )}
      />
      <div className="p-5 pt-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : items.length === 0 ? (
          <EmptyState icon={Wallet} title="No leave types" message="Set up leave types in Settings → Leave Policy." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((b) => (
              <div key={b.code} className="rounded-xl bg-muted/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-fg">{b.name}</p>
                  {b.custom && <Badge tone="primary">Individual</Badge>}
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums text-fg">
                  {fmt(b.remaining)}<span className="text-xs font-normal text-fg-subtle"> / {fmt(b.total)} days</span>
                </p>
                <p className="mt-0.5 text-xs text-fg-subtle">{fmt(b.used)} used</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title={`Edit leave allocation · ${year}`}
        subtitle={employeeName ? `Days ${employeeName} gets for each leave type this year.` : undefined}
        size="lg"
        footer={(
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!changed.length || invalid.length > 0}>
              {changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Leave type</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Used</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase text-fg-subtle">Allocated (days)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const d = draft[b.code] || { value: fmt(b.total), reset: false };
                  const shown = d.reset ? fmt(b.policyTotal ?? b.total) : d.value;
                  const belowUsed = !d.reset && d.value !== '' && Number(d.value) < b.used;
                  return (
                    <tr key={b.code} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-fg">{b.name}</p>
                        <p className="text-xs text-fg-subtle">
                          Company policy: {b.policyTotal != null ? fmt(b.policyTotal) : '—'}
                          {b.custom && !d.reset && ' · set individually'}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-fg-muted">{fmt(b.used)}</td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          min={0}
                          max={366}
                          step={0.5}
                          value={shown}
                          disabled={d.reset}
                          className="h-9 w-28"
                          aria-label={`${b.name} allocation`}
                          onChange={(e) => setDraft((prev) => ({ ...prev, [b.code]: { value: e.target.value, reset: false } }))}
                        />
                        {belowUsed && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                            <AlertTriangle className="h-3 w-3" /> Below the {fmt(b.used)} days already used
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {(b.custom || d.reset) && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            onClick={() => setDraft((prev) => ({ ...prev, [b.code]: d.reset ? { value: fmt(b.total), reset: false } : { value: fmt(b.policyTotal ?? b.total), reset: true } }))}
                          >
                            <RotateCcw className="h-3 w-3" /> {d.reset ? 'Undo' : 'Use policy'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {invalid.length > 0 && <p className="text-xs text-danger">Use whole or half days between 0 and 366.</p>}
          <p className="text-xs text-fg-subtle">
            The first time you set someone&apos;s allocation it is treated as setup and nobody is emailed. After that, every change
            emails {employeeName || 'the employee'} and your company admins with the old and new numbers.
          </p>
        </div>
      </Modal>
    </Card>
  );
}
