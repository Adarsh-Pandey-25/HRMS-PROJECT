import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeIndianRupee, Building2, HeartPulse, Landmark, Receipt, RotateCcw, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, CardHeader, Skeleton } from '../ui';
import { fetchPayrollSetupApi, updatePayrollSetupApi } from '../../api/payroll.api';
import { cn, formatCurrency } from '../../lib/utils';

const STATUTORY = [
  { key: 'pf', label: 'Provident Fund', short: 'PF', icon: Landmark, amountKey: 'pf' },
  { key: 'esi', label: 'ESI', short: 'ESI', icon: HeartPulse, amountKey: 'esi' },
  { key: 'pt', label: 'Professional Tax', short: 'PT', icon: Building2, amountKey: 'pt' },
];

const toDraft = (s) => ({
  pf: s.pf, esi: s.esi, pt: s.pt, tdsMode: s.tdsMode, tdsFixed: s.tdsFixed || 0,
  optouts: s.customDeductions.filter((d) => d.optedOut).map((d) => d.key),
});

function Pill({ on, onClick, disabled, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-[62px] items-center justify-center rounded-full text-[10px] font-extrabold uppercase tracking-wide transition-all duration-200',
        on ? 'bg-primary text-on-primary shadow-sm' : 'bg-muted text-fg-subtle ring-1 ring-inset ring-border',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:scale-105',
      )}
    >
      {children ?? (on ? 'Deduct' : 'Off')}
    </button>
  );
}

/**
 * Employee → Payroll → Payroll setup: which deductions apply to this one
 * person — PF, ESI, Professional Tax, TDS and each of the company's own
 * deductions. Switching a legally compulsory one off shows a warning, never
 * a block. Every saved change is emailed to the company's admins (old → new)
 * and their open payslips are recalculated.
 */
export function PayrollSetupCard({ employeeId, employeeName, canEdit }) {
  const qc = useQueryClient();
  const { data: setup, isLoading, error } = useQuery({
    queryKey: ['payroll', 'setup', employeeId],
    queryFn: () => fetchPayrollSetupApi(employeeId),
    enabled: Boolean(employeeId),
  });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (setup) setDraft(toDraft(setup)); }, [setup]);

  const changes = useMemo(() => {
    if (!setup || !draft) return [];
    const base = toDraft(setup);
    const out = [];
    for (const s of STATUTORY) if (draft[s.key] !== base[s.key]) out.push(s.short);
    if (draft.tdsMode !== base.tdsMode || (draft.tdsMode === 'fixed' && Number(draft.tdsFixed) !== Number(base.tdsFixed))) out.push('TDS');
    const a = [...draft.optouts].sort().join('|');
    if (a !== [...base.optouts].sort().join('|')) out.push('extra deductions');
    return out;
  }, [setup, draft]);

  // Legal reminders for the draft as it stands (the server sends the same on save).
  const warnings = useMemo(() => {
    if (!setup || !draft) return [];
    const w = [];
    const f = setup.facts;
    if (!draft.pf && f.basic <= f.pfStatutoryBasic) w.push(`PF is compulsory when Basic is ₹15,000 or less (here ${formatCurrency(f.basic)}), if your company is registered with EPF.`);
    if (!draft.esi && f.gross <= f.esiThreshold) w.push(`ESI is compulsory when gross is ${formatCurrency(f.esiThreshold)} or less (here ${formatCurrency(f.gross)}), if your company is covered by ESIC.`);
    if (!draft.pt) w.push('Professional Tax is set by state law — switch it off only where the state exempts this person.');
    if (draft.tdsMode === 'none') w.push("No TDS will be deducted — make sure their tax declarations support this.");
    return w;
  }, [setup, draft]);

  const tdsInvalid = draft?.tdsMode === 'fixed' && !(Number(draft.tdsFixed) > 0);

  const save = async () => {
    setSaving(true);
    try {
      const res = await updatePayrollSetupApi(employeeId, {
        pf: draft.pf, esi: draft.esi, pt: draft.pt, tdsMode: draft.tdsMode, tdsFixed: Number(draft.tdsFixed) || 0, optouts: draft.optouts,
      });
      qc.setQueryData(['payroll', 'setup', employeeId], res.setup);
      qc.invalidateQueries({ queryKey: ['payroll', 'salary-preview', employeeId] });
      toast.success(res.changes?.length
        ? `Payroll setup saved${res.emailedAdmins ? ` — ${res.emailedAdmins} admin${res.emailedAdmins === 1 ? '' : 's'} emailed` : ''}`
        : 'Nothing changed');
    } catch (err) {
      toast.error(err.message || 'Could not save the payroll setup');
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <Card>
        <CardHeader title="Payroll setup" />
        <p className="px-5 pb-5 text-sm text-fg-subtle">{error.message}</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 bg-gradient-to-br from-primary/10 via-card to-accent/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-teal text-white shadow-md">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-fg">Payroll setup</h3>
            <p className="text-xs text-fg-subtle">Which deductions apply to {employeeName || 'this employee'}. Changes are emailed to your admins.</p>
          </div>
        </div>
        {setup && (
          <div className="text-right">
            <p className="text-[11px] text-fg-subtle">Full-month take-home</p>
            <p className="text-lg font-extrabold tabular-nums text-fg">{formatCurrency(setup.preview.net)}</p>
          </div>
        )}
      </div>

      {isLoading || !draft ? (
        <div className="p-5"><Skeleton className="h-28 w-full rounded-2xl" /></div>
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {STATUTORY.map((s) => {
              const Icon = s.icon;
              const on = draft[s.key];
              const amount = setup.amounts[s.amountKey];
              const note = s.key === 'esi' && !setup.facts.esiEligible ? `Gross above ${formatCurrency(setup.facts.esiThreshold)} — not due` : null;
              return (
                <div key={s.key} className={cn('rounded-2xl border p-3 transition-colors', on ? 'border-primary/30 bg-primary/5' : 'border-border/70 bg-muted/30')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-fg"><Icon className="h-4 w-4 text-primary" />{s.label}</span>
                    <Pill on={on} disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d, [s.key]: !d[s.key] }))} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-fg-subtle">
                    {note || (amount != null && on ? `${formatCurrency(amount)} a month` : on ? 'Nothing due right now' : 'Not deducted')}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg"><Receipt className="h-4 w-4 text-primary" />TDS</span>
              <div className="inline-flex gap-1 rounded-xl bg-muted/70 p-1">
                {[['company', 'Company rate'], ['fixed', 'Fixed'], ['none', 'None']].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={draft.tdsMode === v}
                    onClick={() => setDraft((d) => ({ ...d, tdsMode: v }))}
                    className={cn('rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all', draft.tdsMode === v ? 'bg-card text-primary shadow-sm' : 'text-fg-muted hover:text-fg')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {draft.tdsMode === 'fixed' && (
              <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
                <BadgeIndianRupee className="h-4 w-4" />
                <input
                  type="number"
                  min={0}
                  disabled={!canEdit}
                  value={draft.tdsFixed}
                  onChange={(e) => setDraft((d) => ({ ...d, tdsFixed: e.target.value }))}
                  className="h-8 w-32 rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary"
                  aria-label="Fixed monthly TDS"
                />
                a month
              </label>
            )}
            {draft.tdsMode === 'company' && setup.amounts.tds != null && (
              <p className="mt-1.5 text-[11px] text-fg-subtle">{formatCurrency(setup.amounts.tds)} a month at the company rate</p>
            )}
          </div>

          {setup.customDeductions.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-fg-subtle">Company deductions</p>
              <div className="flex flex-wrap gap-2">
                {setup.customDeductions.map((d) => {
                  const on = !draft.optouts.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={!canEdit}
                      aria-pressed={on}
                      onClick={() => setDraft((x) => ({ ...x, optouts: on ? [...x.optouts, d.key] : x.optouts.filter((k) => k !== d.key) }))}
                      className={cn(
                        'rounded-2xl px-3 py-2 text-left text-xs font-semibold transition-all',
                        on ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-muted/60 text-fg-subtle line-through',
                        canEdit && 'hover:scale-[1.02]',
                      )}
                    >
                      {d.name}
                      <span className="ml-1.5 font-normal no-underline opacity-80">
                        {d.valueType === 'percent' ? `${d.value}%` : formatCurrency(d.value)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-fg-subtle">Tap to opt {employeeName || 'them'} out of one (or back in).</p>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="space-y-1.5 rounded-2xl bg-warning/10 p-3">
              {warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 text-xs text-fg"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />{w}</p>
              ))}
            </div>
          )}

          {canEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {changes.length > 0 && (
                <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setDraft(toDraft(setup))} disabled={saving}>Undo</Button>
              )}
              <Button size="sm" onClick={save} loading={saving} disabled={!changes.length || tdsInvalid}>
                {changes.length ? `Save ${changes.join(', ')}` : 'No changes'}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-fg-subtle">Only HR or an admin can change this{canEdit === false ? '' : ''} — HR can&apos;t change their own.</p>
          )}
        </div>
      )}
    </Card>
  );
}
