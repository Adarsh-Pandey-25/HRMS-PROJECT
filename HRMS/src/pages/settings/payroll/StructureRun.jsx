import { Banknote, CalendarClock, Layers, Lock, Rocket } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { NumberChip, PillGroup, RuleCard, Sentence, Switch } from './bits';

const COMPONENTS = [
  { key: 'hra', label: 'HRA', pct: 'hraPercent' },
  { key: 'da', label: 'DA', pct: 'daPercent' },
  { key: 'special', label: 'Special Allowance' },
  { key: 'transport', label: 'Transport' },
  { key: 'medical', label: 'Medical' },
];

/** Which salary components the company uses (shown on salary forms). */
export function StructureCard({ form, patch }) {
  const comps = form.components || {};
  return (
    <RuleCard icon={Layers} tone="primary" title="Salary components" summary="Tap to switch a component on or off. Basic is always on.">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-2xl bg-gradient-to-br from-primary to-teal px-4 py-2 text-xs font-bold text-white shadow-md">Basic · always</span>
        {COMPONENTS.map((c) => {
          const on = Boolean(comps[c.key]);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => patch({ components: { ...comps, [c.key]: !on } })}
              className={cn(
                'rounded-2xl px-4 py-2 text-xs font-bold transition-all duration-200',
                on ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'bg-muted/60 text-fg-subtle hover:text-fg',
              )}
            >
              {on ? '✓ ' : '+ '}{c.label}
            </button>
          );
        })}
      </div>
      {(comps.hra || comps.da) && (
        <div className="mt-3 space-y-1">
          {comps.hra && (
            <Sentence>
              HRA is
              <NumberChip value={Number(form.hraPercent) || 0} min={0} max={100} suffix="%" onCommit={(v) => patch({ hraPercent: v })} ariaLabel="HRA percent" />
              of Basic.
            </Sentence>
          )}
          {comps.da && (
            <Sentence>
              DA is
              <NumberChip value={Number(form.daPercent) || 0} min={0} max={100} suffix="%" onCommit={(v) => patch({ daPercent: v })} ariaLabel="DA percent" />
              of Basic.
            </Sentence>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-fg-subtle">These are the suggested splits on the employee salary form; each person&apos;s actual amounts are what payroll pays.</p>
    </RuleCard>
  );
}

/** When payroll runs and what happens automatically. */
export function RunCards({ form, patch }) {
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
      <RuleCard
        icon={Rocket}
        tone="violet"
        title="Auto-run payroll"
        summary={form.autoProcess ? `Drafts are made on day ${form.runDate} every month` : 'Off — you generate drafts yourself'}
        right={<Switch checked={Boolean(form.autoProcess)} onChange={(v) => patch({ autoProcess: v })} ariaLabel="Auto-run payroll" />}
      >
        <Sentence>
          Run on day
          <NumberChip value={Number(form.runDate) || 25} min={1} max={31} onCommit={(v) => patch({ runDate: v })} ariaLabel="payroll run day" />
          of the month.
        </Sentence>
        <p className="text-[11px] text-fg-subtle">In a shorter month (say 30 or 31 in February) it runs on the month&apos;s last day.</p>
      </RuleCard>

      <RuleCard icon={Lock} tone="amber" title="Lock attendance" summary={`${form.autoLockDays} days after the month ends`}>
        <Sentence>
          Attendance locks
          <NumberChip value={Number(form.autoLockDays) || 20} min={1} max={60} onCommit={(v) => patch({ autoLockDays: v })} ariaLabel="auto lock days" />
          days after the month ends.
        </Sentence>
      </RuleCard>

      <RuleCard icon={Banknote} tone="teal" title="Bank file" summary={`${form.bankFileFormat} format`}>
        <PillGroup
          ariaLabel="Bank file format"
          value={form.bankFileFormat}
          onChange={(v) => patch({ bankFileFormat: v })}
          options={['NEFT', 'RTGS', 'Bank-specific'].map((v) => ({ value: v, label: v }))}
        />
      </RuleCard>

      <RuleCard icon={CalendarClock} tone="sky" title="Fixed days (when used)" summary={`${form.workingDaysPerMonth} days — only for the "Fixed days" day rate`}>
        <Sentence>
          A month counts as
          <NumberChip value={Number(form.workingDaysPerMonth) || 26} min={1} max={31} onCommit={(v) => patch({ workingDaysPerMonth: v })} ariaLabel="fixed days per month" />
          days.
        </Sentence>
      </RuleCard>
    </div>
  );
}
