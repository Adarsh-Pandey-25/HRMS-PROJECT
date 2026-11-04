import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeIndianRupee, Building2, Calculator, HeartPulse, IdCard, Landmark, Receipt, RotateCcw, SlidersHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, CardHeader, Skeleton } from '../ui';
import { fetchPayrollSetupApi, updatePayrollSetupApi } from '../../api/payroll.api';
import { cn, formatCurrency } from '../../lib/utils';
import { INDIAN_STATES } from '../../lib/indianStates';

const STATUTORY = [
  { key: 'pf', label: 'Provident Fund', short: 'PF', icon: Landmark, amountKey: 'pf' },
  { key: 'esi', label: 'ESI', short: 'ESI', icon: HeartPulse, amountKey: 'esi' },
  { key: 'pt', label: 'Professional Tax', short: 'PT', icon: Building2, amountKey: 'pt' },
];

// Income-tax amounts HR records for the tax year (rupees). The last four count under the old regime only.
const TAX_AMOUNTS = [
  { key: 'previous_employer_income', label: 'Salary from a previous employer' },
  { key: 'previous_employer_tds', label: 'TDS that employer deducted' },
  { key: 'earlier_income', label: 'Salary paid outside SpaxSync payroll' },
  { key: 'earlier_tds', label: 'TDS deducted on it' },
  { key: 'other_income', label: 'Other income they declared' },
];
const OLD_REGIME_AMOUNTS = [
  { key: 'hra_exemption', label: 'HRA exemption allowed' },
  { key: 'lta_exemption', label: 'LTA exemption allowed' },
  { key: 'chapter8_deductions', label: 'Chapter VIII deductions allowed (80C-type, incl. their PF)' },
  { key: 'other_deductions', label: 'Other deductions allowed (e.g. home-loan interest)' },
];
const ALL_TAX_AMOUNTS = [...TAX_AMOUNTS, ...OLD_REGIME_AMOUNTS];
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// Responses arrive camelCased (api/client.js): previous_employer_income → previousEmployerIncome.
const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const toDraft = (s) => ({
  pf: s.pf,
  vpfPercent: Number(s.vpfPercent || 0),
  esi: s.esi,
  pt: s.pt,
  // The state they work in, for PT; '' = the company's state.
  ptState: s.ptState || '',
  // 'company' follows the company's TDS setting (before TDS from the tax slabs, it meant ₹0 until set).
  tdsMode: s.tdsMode,
  tdsFixed: s.tdsFixed || 0,
  optouts: s.customDeductions.filter((d) => d.optedOut).map((d) => d.key),
  isPwd: Boolean(s.isPwd),
  epsEligible: s.epsEligible !== false,
  pan: s.statutoryIds?.pan || '',
  uan: s.statutoryIds?.uan || '',
  esicIp: s.statutoryIds?.esicIp || '',
  regime: s.tax?.regime === 'old' ? 'old' : 'new',
  // Whether the employee has a regime of their own; else the company's default is shown.
  regimeChosen: Boolean(s.tax?.regimeChosen),
  ...Object.fromEntries(ALL_TAX_AMOUNTS.map((a) => [a.key, Number(s.tax?.[camelKey(a.key)] || 0)])),
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
    if (Number(draft.vpfPercent) !== Number(base.vpfPercent)) out.push('VPF');
    if (draft.tdsMode !== base.tdsMode || (draft.tdsMode === 'fixed' && Number(draft.tdsFixed) !== Number(base.tdsFixed))) out.push('TDS');
    const a = [...draft.optouts].sort().join('|');
    if (a !== [...base.optouts].sort().join('|')) out.push('extra deductions');
    if (['pan', 'uan', 'esicIp'].some((k) => String(draft[k]).trim().toUpperCase() !== String(base[k]).toUpperCase())) out.push('IDs');
    if (draft.isPwd !== base.isPwd || draft.epsEligible !== base.epsEligible) out.push('profile');
    if (draft.ptState !== base.ptState) out.push('PT state');
    if (draft.regime !== base.regime || draft.regimeChosen !== base.regimeChosen || ALL_TAX_AMOUNTS.some((t) => Number(draft[t.key] || 0) !== Number(base[t.key] || 0))) out.push('tax details');
    return out;
  }, [setup, draft]);

  // Legal reminders for the draft as it stands (the server sends the same on save).
  const warnings = useMemo(() => {
    if (!setup || !draft) return [];
    const w = [];
    const f = setup.facts;
    const company = setup.company || {};
    const pfWages = f.pfWages ?? f.basic;
    if (!draft.pf && company.pfPolicy !== 'not_applicable' && f.pfCeiling != null && pfWages <= f.pfCeiling) {
      w.push(`PF is compulsory when Basic + DA is ${formatCurrency(f.pfCeiling)} or less (here ${formatCurrency(pfWages)}).`);
    }
    if (!draft.esi && company.esiApplicable !== false && f.esiThreshold != null && f.gross <= f.esiThreshold) {
      w.push(`ESI is compulsory when gross is ${formatCurrency(f.esiThreshold)} or less (here ${formatCurrency(f.gross)}).`);
    }
    if (!draft.pt) w.push('Professional Tax is set by state law — switch it off only where the state exempts this person.');
    if (draft.tdsMode === 'none') w.push("No TDS will be deducted — make sure their tax declarations support this.");
    return w;
  }, [setup, draft]);

  const tdsInvalid = draft?.tdsMode === 'fixed' && !(Number(draft.tdsFixed) > 0);
  const vpfInvalid = draft && (!(Number(draft.vpfPercent) >= 0) || Number(draft.vpfPercent) > 100);
  const idErrors = useMemo(() => {
    if (!draft) return {};
    const e = {};
    const pan = String(draft.pan || '').trim().toUpperCase();
    if (pan && !PAN_PATTERN.test(pan)) e.pan = '5 letters, 4 digits, 1 letter (like ABCDE1234F)';
    if (draft.uan && !/^\d{12}$/.test(String(draft.uan).replace(/\s+/g, ''))) e.uan = '12 digits';
    if (draft.esicIp && !/^\d{10}$/.test(String(draft.esicIp).replace(/\s+/g, ''))) e.esicIp = '10 digits';
    for (const t of ALL_TAX_AMOUNTS) if (!(Number(draft[t.key] || 0) >= 0)) e[t.key] = 'Enter ₹0 or more';
    return e;
  }, [draft]);
  const detailsInvalid = Object.keys(idErrors).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const res = await updatePayrollSetupApi(employeeId, {
        pf: draft.pf,
        vpfPercent: Math.round(Number(draft.vpfPercent || 0) * 100) / 100,
        esi: draft.esi,
        pt: draft.pt,
        ptState: draft.ptState || null,
        tdsMode: draft.tdsMode,
        tdsFixed: Number(draft.tdsFixed) || 0,
        optouts: draft.optouts,
        isPwd: draft.isPwd,
        epsEligible: draft.epsEligible,
        statutoryIds: {
          pan: String(draft.pan || '').trim().toUpperCase(),
          uan: String(draft.uan || '').replace(/\s+/g, ''),
          esicIp: String(draft.esicIp || '').replace(/\s+/g, ''),
        },
        tax: {
          taxYear: setup.tax?.taxYear,
          // Sent only when the employee has one, or HR just chose one.
          ...(draft.regimeChosen ? { regime: draft.regime } : {}),
          ...Object.fromEntries(ALL_TAX_AMOUNTS.map((t) => [t.key, Math.round(Number(draft[t.key] || 0) * 100) / 100])),
        },
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
              const company = setup.company || {};
              let note = null;
              if (s.key === 'pf' && company.pfPolicy === 'not_applicable') note = 'PF doesn\'t apply to your company (Settings → Payroll)';
              else if (s.key === 'esi' && company.esiApplicable === false) note = 'Your company isn\'t covered by ESIC (Settings → Payroll)';
              else if (s.key === 'esi' && !setup.facts.esiEligible) note = `Gross above ${formatCurrency(setup.facts.esiThreshold)} — not due`;
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

          {draft.pf && (setup.company || {}).pfPolicy !== 'not_applicable' && (
            <label className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 p-3 text-xs text-fg-muted">
              <Landmark className="h-4 w-4 text-primary" />
              <span className="font-semibold text-fg">Voluntary PF (VPF)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                disabled={!canEdit}
                value={draft.vpfPercent}
                onChange={(e) => setDraft((d) => ({ ...d, vpfPercent: e.target.value }))}
                className="h-8 w-20 rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary"
                aria-label="Voluntary PF percent"
              />
              % of Basic + DA on top of the 12%, if they ask for it.
              {setup.amounts.vpf != null && <span className="text-fg-subtle">({formatCurrency(setup.amounts.vpf)} a month)</span>}
            </label>
          )}

          <div className="rounded-2xl border border-border/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg"><Receipt className="h-4 w-4 text-primary" />TDS</span>
              <div className="inline-flex gap-1 rounded-xl bg-muted/70 p-1">
                {((setup.company || {}).tdsPolicy === 'projected'
                  ? [['company', 'From tax slabs'], ['fixed', 'Monthly amount'], ['none', 'None']]
                  : [['fixed', 'Monthly amount'], ['none', 'None']]).map(([v, l]) => (
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
            {draft.tdsMode === 'company' && (setup.company || {}).tdsPolicy !== 'projected' && (
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                Not set yet — nothing is deducted until you enter their monthly TDS or choose None.
              </p>
            )}
            {(setup.company || {}).tdsPolicy === 'projected' && <TaxWorking tax={setup.tax} mode={draft.tdsMode} />}
            {(setup.company || {}).tdsPolicy === 'none' && (
              <p className="mt-1.5 text-[11px] text-fg-subtle">Your company deducts no TDS (Settings → Payroll), so this isn&apos;t used.</p>
            )}
          </div>

          <StatutoryDetails setup={setup} draft={draft} setDraft={setDraft} canEdit={canEdit} errors={idErrors} />

          {(setup.blockers || []).length > 0 && (
            <div className="space-y-1.5 rounded-2xl bg-danger/10 p-3">
              {setup.blockers.map((b) => (
                <p key={b.code} className="flex items-start gap-2 text-xs font-semibold text-danger"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{b.message}</p>
              ))}
            </div>
          )}

          {(setup.employerContributions || []).length > 0 && (
            <p className="text-[11px] text-fg-subtle">
              The company also pays {formatCurrency(setup.employerContributions.reduce((s, e) => s + Number(e.amount || 0), 0))} a month
              for them ({setup.employerContributions.map((e) => e.name).join(', ')}) — not deducted from their pay.
            </p>
          )}

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
              <Button size="sm" onClick={save} loading={saving} disabled={!changes.length || tdsInvalid || vpfInvalid || detailsInvalid}>
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

/** This month's TDS as SpaxSync works it out from the tax slabs, in a few lines. */
function TaxWorking({ tax, mode }) {
  const w = tax?.worksheet;
  if (!w) return null;
  const rows = [
    ['Salary this tax year (paid + this month + coming months)', w.projectedSalary],
    ...(w.otherIncome ? [['Other income', w.otherIncome]] : []),
    ['Taxable after deductions', w.taxableIncome],
    [`Tax for ${w.taxYear} (${w.regime === 'old' ? 'old' : 'new'} regime, with cess)`, w.annualTax],
    ['TDS already deducted', w.tdsBefore],
  ];
  return (
    <div className="mt-2 rounded-xl bg-muted/40 p-2.5 text-[11px] text-fg-muted">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-fg"><Calculator className="h-3.5 w-3.5 text-primary" />How this month&apos;s TDS is worked out</p>
      {rows.map(([label, value]) => (
        <p key={label} className="flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{formatCurrency(value)}</span></p>
      ))}
      <p className="mt-1 flex justify-between gap-3 font-semibold text-fg">
        <span>This month ({formatCurrency(w.remaining)} left ÷ {w.monthsLeft} month{w.monthsLeft === 1 ? '' : 's'})</span>
        <span className="tabular-nums">{formatCurrency(w.tds)}</span>
      </p>
      {mode !== 'company' && (
        <p className="mt-1 text-fg-subtle">
          Shown for information — {mode === 'none' ? 'None' : 'the monthly amount'}, chosen above, is what payroll uses.
        </p>
      )}
      {w.assumedFullYear && <p className="mt-1 text-fg-subtle">No payslips this tax year yet, so earlier months are assumed at this pay.</p>}
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="block text-[11px] text-fg-muted">
      <span className="mb-1 block font-semibold text-fg">{label}</span>
      {children}
      {error && <span className="mt-0.5 block font-semibold text-danger">{error}</span>}
    </label>
  );
}

const inputClass = 'h-8 w-full rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary disabled:opacity-60';

/**
 * PAN, UAN and ESIC number, disability and pension membership, and the
 * tax year's income-tax details (regime, salary earlier this year, and the
 * old regime's allowed deductions) — what TDS from the tax slabs uses.
 */
function StatutoryDetails({
  setup, draft, setDraft, canEdit, errors,
}) {
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const projected = (setup.company || {}).tdsPolicy === 'projected';
  const amountInput = (t) => (
    <Field key={t.key} label={t.label} error={errors[t.key]}>
      <input type="number" min={0} step="1" disabled={!canEdit} value={draft[t.key]} onChange={set(t.key)} className={inputClass} aria-label={t.label} />
    </Field>
  );
  return (
    <details className="group rounded-2xl border border-border/70 p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg"><IdCard className="h-4 w-4 text-primary" />Statutory and tax details</span>
        <span className="text-[11px] text-fg-subtle">
          {draft.pan ? 'PAN recorded' : 'No PAN'} · {draft.regime === 'old' ? 'Old' : 'New'} regime {setup.tax?.taxYear || ''}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="PAN" error={errors.pan}>
            <input disabled={!canEdit} value={draft.pan} onChange={(e) => setDraft((d) => ({ ...d, pan: e.target.value.toUpperCase() }))} maxLength={10} className={cn(inputClass, 'uppercase')} placeholder="ABCDE1234F" aria-label="PAN" />
          </Field>
          <Field label="UAN (PF)" error={errors.uan}>
            <input disabled={!canEdit} value={draft.uan} onChange={set('uan')} inputMode="numeric" maxLength={14} className={inputClass} placeholder="12 digits" aria-label="UAN" />
          </Field>
          <Field label="ESIC number" error={errors.esicIp}>
            <input disabled={!canEdit} value={draft.esicIp} onChange={set('esicIp')} inputMode="numeric" maxLength={12} className={inputClass} placeholder="10 digits" aria-label="ESIC number" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-fg-muted">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={draft.isPwd} onChange={(e) => setDraft((d) => ({ ...d, isPwd: e.target.checked }))} />
            Person with disability (ESI applies up to ₹25,000 gross)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEdit} checked={draft.epsEligible} onChange={(e) => setDraft((d) => ({ ...d, epsEligible: e.target.checked }))} />
            Pension (EPS) member — untick if all employer PF goes to EPF
          </label>
        </div>
        <Field label="Works in (decides their Professional Tax)">
          <select disabled={!canEdit} value={draft.ptState} onChange={set('ptState')} className={inputClass} aria-label="State they work in">
            <option value="">The company's state{setup.company?.ptState ? ` (${setup.company.ptState})` : ''}</option>
            {INDIAN_STATES.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </Field>
        <div className="rounded-xl bg-muted/30 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-fg">Income tax {setup.tax?.taxYear}</span>
            <div className="inline-flex gap-1 rounded-xl bg-muted/70 p-1">
              {[['new', 'New regime'], ['old', 'Old regime']].map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={draft.regime === v}
                  onClick={() => setDraft((d) => ({ ...d, regime: v, regimeChosen: true }))}
                  className={cn('rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all', draft.regime === v ? 'bg-card text-primary shadow-sm' : 'text-fg-muted hover:text-fg')}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          {!projected && <p className="mt-1 text-[11px] text-fg-subtle">Used once your company works TDS out from the tax slabs (Settings → Payroll).</p>}
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TAX_AMOUNTS.map(amountInput)}
          </div>
          {draft.regime === 'old' && (
            <>
              <p className="mt-3 text-[11px] text-fg-subtle">Old regime: the amounts allowed for the year after the legal limits, from their declaration and proofs.</p>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {OLD_REGIME_AMOUNTS.map(amountInput)}
              </div>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
