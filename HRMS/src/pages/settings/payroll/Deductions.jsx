import { useState } from 'react';
import { BadgePercent, Building2, HeartHandshake, HeartPulse, Landmark, Plus, Receipt, Sparkles, Trash2 } from 'lucide-react';
import { cn, formatCurrency } from '../../../lib/utils';
import { INDIAN_STATES, PT_APPLICABLE_LABEL, ptKindOf } from '../../../lib/indianStates';
import { Select } from '../../../components/ui';
import { NumberChip, PillGroup, RuleCard, Tag } from './bits';

const PT_STATE_OPTIONS = [
  { value: '', label: 'Choose a state…' },
  ...INDIAN_STATES.map((s) => ({ value: s.name, label: `${s.name}${PT_APPLICABLE_LABEL[s.ptApplicable]}` })),
];

const PF_SUMMARY = {
  statutory_ceiling: '12% of Basic + DA, counted up to the legal limit',
  full_wages: '12% of the full Basic + DA',
  not_applicable: 'No PF — the company isn\'t registered with EPF',
};

const ChooseNote = ({ children }) => <p className="mt-2 text-[11px] font-semibold text-warning">{children}</p>;
const Law = ({ children }) => <p className="mt-2 text-[11px] text-fg-subtle">{children}</p>;

/**
 * How PF, ESI, PT and TDS work for this company. The company chooses how
 * each applies (owner, 2 Nov 2026: every company decides its own); the rates
 * themselves are set by law and kept up to date by SpaxSync, so they are
 * shown, not edited. Per-person switches live on each employee's Payroll tab.
 */
const TDS_SUMMARY = {
  projected: 'Worked out each month from the income-tax slabs',
  fixed_per_employee: 'A monthly amount per employee, entered by HR',
  none: 'No TDS deducted',
};

const MAX_PT_SLABS = 12;

/**
 * Professional Tax slabs the company enters for a state SpaxSync has no
 * table for: "from this monthly pay, this much PT" (and, if the state says
 * so, a different February amount). Below the first row nothing is due.
 */
function PtSlabEditor({ slabs, onChange }) {
  const rows = slabs || [];
  const set = (i, key, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const remove = (i) => onChange(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows);
  const add = () => {
    const last = rows[rows.length - 1];
    onChange([...rows, { from: (Number(last?.from) || 0) + 5000, amount: Number(last?.amount) || 0, february_amount: null }]);
  };
  const froms = rows.map((r) => Number(r.from));
  const duplicate = new Set(froms).size !== froms.length;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        <span>Monthly pay from</span>
        <span>PT a month</span>
        <span>February</span>
        <span className="sr-only">Remove</span>
      </div>
      {rows.map((r, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2">
          <NumberChip value={Number(r.from) || 0} min={0} max={10000000} step={1000} prefix="₹" width="w-20" onCommit={(v) => set(i, 'from', v)} ariaLabel={`slab ${i + 1} starts at monthly pay`} />
          <NumberChip value={Number(r.amount) || 0} min={0} max={2500} step={10} prefix="₹" width="w-12" onCommit={(v) => set(i, 'amount', v)} ariaLabel={`slab ${i + 1} PT a month`} />
          {r.february_amount == null ? (
            <button type="button" className="text-[11px] font-semibold text-primary hover:underline" onClick={() => set(i, 'february_amount', Number(r.amount) || 0)}>
              Same
            </button>
          ) : (
            <span className="inline-flex items-center">
              <NumberChip value={Number(r.february_amount) || 0} min={0} max={2500} step={10} prefix="₹" width="w-12" onCommit={(v) => set(i, 'february_amount', v)} ariaLabel={`slab ${i + 1} PT in February`} />
              <button type="button" className="ml-1 text-[11px] text-fg-subtle hover:underline" onClick={() => set(i, 'february_amount', null)}>same</button>
            </span>
          )}
          <button type="button" disabled={rows.length <= 1} onClick={() => remove(i)} aria-label={`Remove slab ${i + 1}`} className="rounded p-1 text-fg-subtle hover:text-danger disabled:opacity-30">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {duplicate && <p className="text-[11px] font-semibold text-danger">Two rows start at the same pay — change one, or payroll can&apos;t use these slabs.</p>}
      {rows.length < MAX_PT_SLABS && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
          <Plus className="h-3 w-3" /> Add a slab
        </button>
      )}
      <Law>Copy the slabs from your state&apos;s PT notification; below the first row nothing is deducted.</Law>
    </div>
  );
}

/**
 * Staff who work in other states pay that state's PT (their Payroll setup says
 * where). For a state SpaxSync has a table for, nothing is needed here; for
 * one it hasn't, the company enters the slabs once.
 */
function OtherStatesPt({ list, ownState, onChange }) {
  const rows = list || [];
  const used = new Set([ownState, ...rows.map((r) => r.state)]);
  const choices = INDIAN_STATES.filter((s) => ['manual', 'verify'].includes(ptKindOf(s.name)) && !used.has(s.name));
  const setSlabs = (i, slabs) => onChange(rows.map((r, j) => (j === i ? { ...r, slabs } : r)));
  return (
    <div className="mt-4 space-y-3 border-t border-border/60 pt-3">
      <p className="text-xs font-semibold text-fg">Staff in other states</p>
      <p className="text-[11px] text-fg-subtle">
        Set where someone works in their profile → Payroll → Payroll setup. States with a SpaxSync table need nothing here;
        for the others, enter their slabs once.
      </p>
      {rows.map((r, i) => (
        <div key={r.state} className="rounded-xl bg-muted/30 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-fg">{r.state}</span>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-[11px] text-fg-subtle hover:text-danger">Remove</button>
          </div>
          <PtSlabEditor slabs={r.slabs} onChange={(slabs) => setSlabs(i, slabs)} />
        </div>
      ))}
      {choices.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            value=""
            onChange={(e) => e.target.value && onChange([...rows, { state: e.target.value, slabs: [{ from: 0, amount: 0, february_amount: null }] }])}
            options={[{ value: '', label: 'Add a state…' }, ...choices.map((s) => ({ value: s.name, label: s.name }))]}
            aria-label="Add a state your staff work in"
          />
        </div>
      )}
    </div>
  );
}

const MONTH_LETTERS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Labour Welfare Fund: the employee and employer amounts of each state the
 * company's staff work in, and the months they are deducted — from the
 * state's LWF notification (SpaxSync ships no LWF table).
 */
function LwfCard({ list, onChange }) {
  const rows = list || [];
  const set = (i, key, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const toggleMonth = (i, m) => {
    const months = rows[i].months || [];
    set(i, 'months', months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b));
  };
  const used = new Set(rows.map((r) => r.state));
  const choices = INDIAN_STATES.filter((s) => !used.has(s.name));
  return (
    <RuleCard icon={HeartHandshake} tone="teal" title="Labour Welfare Fund (LWF)" summary={rows.length ? rows.map((r) => r.state).join(', ') : 'Not deducted'}>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.state} className="rounded-xl bg-muted/30 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">{r.state}</span>
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-[11px] text-fg-subtle hover:text-danger">Remove</button>
            </div>
            <div className="mt-1 text-sm leading-8 text-fg-muted">
              Employee
              <NumberChip value={Number(r.employee) || 0} min={0} max={1000} step={1} prefix="₹" width="w-12" onCommit={(v) => set(i, 'employee', v)} ariaLabel={`${r.state} LWF employee`} />
              employer
              <NumberChip value={Number(r.employer) || 0} min={0} max={1000} step={1} prefix="₹" width="w-12" onCommit={(v) => set(i, 'employer', v)} ariaLabel={`${r.state} LWF employer`} />
              , deducted in:
            </div>
            <div className="flex flex-wrap gap-1">
              {MONTH_LETTERS.map((label, k) => {
                const on = (r.months || []).includes(k + 1);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleMonth(i, k + 1)}
                    className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', on ? 'bg-primary/10 text-primary ring-primary/30' : 'text-fg-subtle ring-border')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {!(r.months || []).length && <p className="mt-1 text-[11px] font-semibold text-danger">Choose the months it is deducted in, or it won&apos;t be.</p>}
          </div>
        ))}
        <Select
          value=""
          onChange={(e) => e.target.value && onChange([...rows, { state: e.target.value, employee: 0, employer: 0, months: [] }])}
          options={[{ value: '', label: 'Add a state…' }, ...choices.map((s) => ({ value: s.name, label: s.name }))]}
          aria-label="Add an LWF state"
        />
        <Law>
          Enter the amounts from your state&apos;s LWF notification. Staff pay the LWF of the state they work in (their Payroll setup;
          the company&apos;s PT state otherwise). The employer&apos;s share counts in the CTC.
        </Law>
      </div>
    </RuleCard>
  );
}

export function StatutoryCards({ form, patch }) {
  const ptKind = ptKindOf(form.ptState);
  const hasSlabs = Array.isArray(form.ptManualSlabs) && form.ptManualSlabs.length > 0;
  let ptSummary = 'Choose the state your staff work in';
  if (ptKind === 'slab') ptSummary = `${form.ptState} slab, on pay actually earned`;
  else if (ptKind === 'none') ptSummary = `${form.ptState} — no Professional Tax`;
  else if (ptKind === 'manual' || ptKind === 'verify') {
    if (hasSlabs) ptSummary = `${form.ptState} — your slabs, on pay actually earned`;
    else if (form.ptManualAmount === 0) ptSummary = `${form.ptState} — no PT deducted`;
    else if (form.ptManualAmount > 0) ptSummary = `${form.ptState} — ${formatCurrency(form.ptManualAmount)} a month for everyone`;
    else ptSummary = `${form.ptState} — enter the slabs or the monthly amount`;
  }
  let ptMethod = null;
  if (hasSlabs) ptMethod = 'slabs';
  else if (form.ptManualAmount === 0) ptMethod = 'none';
  else if (form.ptManualAmount != null) ptMethod = 'amount';
  const choosePtMethod = (v) => {
    if (v === 'slabs') patch({ ptManualSlabs: hasSlabs ? form.ptManualSlabs : [{ from: 0, amount: 0, february_amount: null }], ptManualAmount: null });
    else if (v === 'none') patch({ ptManualSlabs: null, ptManualAmount: 0 });
    else patch({ ptManualSlabs: null, ptManualAmount: form.ptManualAmount > 0 ? form.ptManualAmount : 200 });
  };

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
      <RuleCard icon={Landmark} tone="primary" title="Provident Fund (PF)" summary={PF_SUMMARY[form.pfPolicy] || 'Choose how PF works for your company'}>
        <PillGroup
          size="sm"
          ariaLabel="PF method"
          value={form.pfPolicy}
          onChange={(v) => patch({ pfPolicy: v })}
          options={[
            { value: 'statutory_ceiling', label: 'Up to the legal limit' },
            { value: 'full_wages', label: 'Full Basic + DA' },
            { value: 'not_applicable', label: 'Not applicable' },
          ]}
        />
        {!form.pfPolicy && <ChooseNote>Not chosen yet — until you choose, payroll counts PF up to the legal limit.</ChooseNote>}
        <Law>
          Set by law: the employee pays 12% of Basic + DA and the employer 12% (8.33% of it goes to the pension, EPS).
          The legal limit is ₹15,000 a month until 16 Sep 2026 and ₹25,000 from 17 Sep 2026; &quot;Full Basic + DA&quot; goes above it,
          by agreement. Voluntary PF (VPF) and per-person switches are on each employee&apos;s Payroll tab.
        </Law>
      </RuleCard>

      <RuleCard icon={HeartPulse} tone="rose" title="ESI" summary={form.esiApplicable === false ? 'Not covered by ESIC — no ESI' : '0.75% employee + 3.25% employer, for pay up to ₹21,000'}>
        <PillGroup
          size="sm"
          ariaLabel="ESI"
          value={form.esiApplicable === null ? null : (form.esiApplicable ? 'yes' : 'no')}
          onChange={(v) => patch({ esiApplicable: v === 'yes' })}
          options={[{ value: 'yes', label: 'Covered by ESIC' }, { value: 'no', label: 'Not covered' }]}
        />
        {form.esiApplicable === null && <ChooseNote>Not chosen yet — until you choose, payroll treats the company as covered.</ChooseNote>}
        <Law>
          Set by law: 0.75% from the employee (nothing if they earn ₹176 a day or less) and 3.25% from the employer, when
          monthly pay is ₹21,000 or less (₹25,000 for persons with disability). Once covered, an employee stays covered to
          the end of the six-month period.
        </Law>
      </RuleCard>

      <RuleCard icon={Building2} tone="sky" title="Professional Tax" summary={ptSummary}>
        <Select
          label="State your staff work in"
          options={PT_STATE_OPTIONS}
          value={form.ptState}
          onChange={(e) => patch({
            ptState: e.target.value, ptManualAmount: null, ptManualSlabs: null, ptStateSet: Boolean(e.target.value),
          })}
        />
        {form.ptState === 'Karnataka' && !form.ptStateSet && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChooseNote>The earlier settings screen filled in Karnataka by itself. Is it right? Payroll won&apos;t charge PT until you confirm.</ChooseNote>
            <button type="button" onClick={() => patch({ ptStateSet: true })} className="mt-2 rounded-full border border-primary/40 px-2.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10">
              Yes, Karnataka
            </button>
          </div>
        )}
        {ptKind === 'slab' && <Law>SpaxSync applies {form.ptState}&apos;s PT slab to the pay actually earned each month.</Law>}
        {ptKind === 'none' && <Law>{form.ptState} levies no Professional Tax — nothing is deducted.</Law>}
        {(ptKind === 'manual' || ptKind === 'verify') && (
          <div className="mt-2 space-y-2">
            <Law>
              {ptKind === 'verify'
                ? `Check with your tax consultant whether ${form.ptState} levies PT. `
                : `SpaxSync has no PT table for ${form.ptState} yet. `}
              Enter your state&apos;s slabs (best: low earners pay less or nothing), one amount for everyone, or choose No PT.
            </Law>
            <div className="flex flex-wrap items-center gap-2">
              <PillGroup
                size="sm"
                ariaLabel="Professional Tax method"
                value={ptMethod}
                onChange={choosePtMethod}
                options={[{ value: 'slabs', label: 'Slabs by pay' }, { value: 'amount', label: 'One amount' }, { value: 'none', label: 'No PT' }]}
              />
              {ptMethod === 'amount' && form.ptManualAmount > 0 && (
                <NumberChip value={Number(form.ptManualAmount)} min={1} max={2500} step={25} prefix="₹" width="w-16" onCommit={(v) => patch({ ptManualAmount: v })} ariaLabel="monthly Professional Tax" />
              )}
            </div>
            {ptMethod === 'slabs' && <PtSlabEditor slabs={form.ptManualSlabs} onChange={(next) => patch({ ptManualSlabs: next })} />}
            {ptMethod === 'amount' && <Law>The same amount is deducted from everyone, whatever they earn.</Law>}
            {ptMethod == null && <p className="text-[11px] font-semibold text-danger">Payroll can&apos;t run until this is set.</p>}
          </div>
        )}
        {ptKind === 'unknown' && <p className="mt-2 text-[11px] font-semibold text-danger">Choose a state — payroll can&apos;t run without it.</p>}
        {form.ptState && (
          <OtherStatesPt list={form.ptOtherStates} ownState={form.ptState} onChange={(ptOtherStates) => patch({ ptOtherStates })} />
        )}
      </RuleCard>

      <RuleCard icon={Receipt} tone="amber" title="TDS (income tax)" summary={TDS_SUMMARY[form.tdsPolicy] || TDS_SUMMARY.fixed_per_employee}>
        <PillGroup
          size="sm"
          ariaLabel="TDS"
          value={form.tdsPolicy}
          onChange={(v) => patch({ tdsPolicy: v })}
          options={[
            { value: 'projected', label: 'Work out from tax slabs' },
            { value: 'fixed_per_employee', label: 'Amount per employee' },
            { value: 'none', label: 'No TDS' },
          ]}
        />
        {form.tdsPolicy === 'projected' ? (
          <Law>
            Each month SpaxSync estimates the year&apos;s salary (paid so far + this month + the coming months), works out the
            tax under the employee&apos;s regime (new unless they chose the old one), takes off the TDS already deducted and
            spreads the rest over the months left; March settles the year. On each employee&apos;s Payroll tab, record their
            PAN, any salary from a previous employer (or paid before SpaxSync) this year, and for the old regime the
            deductions allowed. A fixed amount set for someone there still wins.
          </Law>
        ) : (
          <Law>
            HR enters each person&apos;s monthly TDS on their Payroll tab (under the new regime, most people earning up to
            about ₹12.75 lakh a year owe none). The old flat percentage was wrong for almost everyone, so it is gone.
          </Law>
        )}
      </RuleCard>

      <LwfCard list={form.lwfStates} onChange={(lwfStates) => patch({ lwfStates })} />
    </div>
  );
}

function newOption() {
  return { id: `PO-${Date.now()}`, name: '', kind: 'deduction', valueType: 'fixed', value: 0, base: 'basic', active: true };
}

/** The company's own extra lines — deductions (opt-outable per person) or allowances. */
export function CustomOptions({ options, onChange }) {
  const [editing, setEditing] = useState(null);
  const update = (id, p) => onChange(options.map((o) => (o.id === id ? { ...o, ...p } : o)));
  const add = () => { const o = newOption(); onChange([...options, o]); setEditing(o.id); };
  const remove = (id) => onChange(options.filter((o) => o.id !== id));
  return (
    <RuleCard
      icon={Sparkles}
      tone="violet"
      title="Your own deductions & allowances"
      summary="Canteen, insurance, meal card, LWF… Anyone can be opted out of a deduction on their Payroll tab."
      right={(
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      )}
    >
      {options.length === 0 ? (
        <p className="text-xs text-fg-subtle">Nothing yet.</p>
      ) : (
        <div className="space-y-2">
          {options.map((o) => {
            const open = editing === o.id || !o.name;
            const amountLabel = o.valueType === 'percent' ? `${o.value}% of ${o.base === 'gross' ? 'gross' : 'Basic'}` : formatCurrency(o.value);
            return (
              <div key={o.id} className={cn('rounded-2xl border transition-colors', open ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-muted/30')}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold', o.kind === 'allowance' ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger')}>
                    {o.kind === 'allowance' ? '+' : '−'}
                  </span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(open ? null : o.id)}>
                    <p className={cn('truncate text-sm font-semibold', o.active === false ? 'text-fg-subtle line-through' : 'text-fg')}>{o.name || 'New item'}</p>
                    <p className="text-[11px] text-fg-subtle">{o.kind === 'allowance' ? 'Allowance' : 'Deduction'} · {amountLabel}</p>
                  </button>
                  <Tag tone={o.active === false ? 'neutral' : 'good'}>{o.active === false ? 'Paused' : 'Active'}</Tag>
                  <button type="button" onClick={() => remove(o.id)} aria-label={`Remove ${o.name || 'item'}`} className="rounded-lg p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {open && (
                  <div className="space-y-2 border-t border-border/60 px-3 py-3">
                    <input
                      autoFocus={!o.name}
                      defaultValue={o.name}
                      placeholder="Name, e.g. Canteen"
                      aria-label="Name"
                      onBlur={(e) => e.target.value.trim() !== o.name && update(o.id, { name: e.target.value.trim() })}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      className="h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <PillGroup size="sm" ariaLabel="Kind" value={o.kind} onChange={(v) => update(o.id, { kind: v })} options={[{ value: 'deduction', label: 'Deduction' }, { value: 'allowance', label: 'Allowance' }]} />
                      <PillGroup size="sm" ariaLabel="Amount type" value={o.valueType} onChange={(v) => update(o.id, { valueType: v })} options={[{ value: 'fixed', label: '₹ fixed' }, { value: 'percent', label: '% of', icon: BadgePercent }]} />
                      {o.valueType === 'percent' && (
                        <PillGroup size="sm" ariaLabel="Base" value={o.base} onChange={(v) => update(o.id, { base: v })} options={[{ value: 'basic', label: 'Basic' }, { value: 'gross', label: 'Gross' }]} />
                      )}
                      <NumberChip
                        value={Number(o.value) || 0}
                        min={0}
                        max={o.valueType === 'percent' ? 100 : 1000000}
                        step={o.valueType === 'percent' ? 0.5 : 50}
                        prefix={o.valueType === 'percent' ? undefined : '₹'}
                        suffix={o.valueType === 'percent' ? '%' : undefined}
                        width="w-16"
                        onCommit={(v) => update(o.id, { value: v })}
                        ariaLabel="Amount"
                      />
                      <PillGroup size="sm" ariaLabel="Active" value={o.active === false ? 'off' : 'on'} onChange={(v) => update(o.id, { active: v === 'on' })} options={[{ value: 'on', label: 'Active' }, { value: 'off', label: 'Paused' }]} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </RuleCard>
  );
}
