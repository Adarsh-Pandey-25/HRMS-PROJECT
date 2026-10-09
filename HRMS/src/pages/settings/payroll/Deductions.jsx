import { useState } from 'react';
import { BadgePercent, Building2, HeartPulse, Landmark, Plus, Receipt, Sparkles, Trash2 } from 'lucide-react';
import { cn, formatCurrency } from '../../../lib/utils';
import { INDIAN_STATES, PT_APPLICABLE_LABEL } from '../../../lib/indianStates';
import { Select } from '../../../components/ui';
import { NumberChip, PillGroup, RuleCard, Sentence, Tag } from './bits';

const PT_STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s.name, label: `${s.name}${PT_APPLICABLE_LABEL[s.ptApplicable]}` }));

/** The four statutory deductions, company-wide. Per-person switches live on each employee's Payroll tab. */
export function StatutoryCards({ form, patch }) {
  const ceilingOn = form.pfWageCeiling != null && Number(form.pfWageCeiling) > 0;
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
      <RuleCard icon={Landmark} tone="primary" title="Provident Fund (PF)" summary={`${form.pfEmployeePercent}% of earned Basic${ceilingOn ? `, Basic capped at ${formatCurrency(form.pfWageCeiling)}` : ''}`}>
        <Sentence>
          Employee pays
          <NumberChip value={form.pfEmployeePercent} min={0} max={100} step={0.5} suffix="%" onCommit={(v) => patch({ pfEmployeePercent: v })} ariaLabel="PF percent" />
          of Basic.
        </Sentence>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <PillGroup
            size="sm"
            ariaLabel="PF wage ceiling"
            value={ceilingOn ? 'cap' : 'full'}
            onChange={(v) => patch({ pfWageCeiling: v === 'cap' ? 15000 : null })}
            options={[{ value: 'full', label: 'On full Basic' }, { value: 'cap', label: 'Cap the Basic' }]}
          />
          {ceilingOn && (
            <NumberChip value={Number(form.pfWageCeiling)} min={1000} max={1000000} step={500} prefix="₹" width="w-20" onCommit={(v) => patch({ pfWageCeiling: v })} ariaLabel="PF wage ceiling" />
          )}
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">₹15,000 is the EPF statutory wage ceiling. Loss of pay reduces the Basic PF is worked on.</p>
      </RuleCard>

      <RuleCard icon={HeartPulse} tone="rose" title="ESI" summary={`${form.esiEmployeePercent}% of earned gross, when gross is ${formatCurrency(form.esiThreshold)} or less`}>
        <Sentence>
          Employee pays
          <NumberChip value={form.esiEmployeePercent} min={0} max={10} step={0.25} suffix="%" width="w-14" onCommit={(v) => patch({ esiEmployeePercent: v })} ariaLabel="ESI percent" />
          when monthly gross is up to
          <NumberChip value={form.esiThreshold} min={0} max={1000000} step={500} prefix="₹" width="w-20" onCommit={(v) => patch({ esiThreshold: v })} ariaLabel="ESI threshold" />
        </Sentence>
        <p className="mt-1 text-[11px] text-fg-subtle">0.75% and ₹21,000 are the current ESIC rates. Switch it off per person on their Payroll tab.</p>
      </RuleCard>

      <RuleCard icon={Building2} tone="sky" title="Professional Tax" summary={form.ptState ? `${form.ptState} slab, else ${formatCurrency(form.professionalTaxAmount)} a month` : `${formatCurrency(form.professionalTaxAmount)} a month`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Select label="State" options={PT_STATE_OPTIONS} value={form.ptState} onChange={(e) => patch({ ptState: e.target.value })} />
          <Sentence className="whitespace-nowrap">
            Flat
            <NumberChip value={form.professionalTaxAmount} min={0} max={10000} step={50} prefix="₹" width="w-14" onCommit={(v) => patch({ professionalTaxAmount: v })} ariaLabel="flat professional tax" />
          </Sentence>
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">States with a known slab use it (on pay actually earned); the flat amount covers the rest.</p>
      </RuleCard>

      <RuleCard icon={Receipt} tone="amber" title="TDS" summary={form.tdsMode === 'manual' ? 'Entered per employee' : `${form.tdsPercent}% of earned gross`}>
        <div className="flex flex-wrap items-center gap-2">
          <PillGroup
            size="sm"
            ariaLabel="TDS mode"
            value={form.tdsMode === 'manual' ? 'manual' : 'auto'}
            onChange={(v) => patch({ tdsMode: v })}
            options={[{ value: 'auto', label: 'A % of gross' }, { value: 'manual', label: 'Per employee' }]}
          />
          {form.tdsMode !== 'manual' && (
            <NumberChip value={form.tdsPercent} min={0} max={50} step={0.5} suffix="%" onCommit={(v) => patch({ tdsPercent: v })} ariaLabel="TDS percent" />
          )}
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">An estimate. Fixed amounts or no TDS for one person go on their Payroll tab.</p>
      </RuleCard>
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
