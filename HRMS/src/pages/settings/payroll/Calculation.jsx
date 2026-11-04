import { useQuery } from '@tanstack/react-query';
import { Calculator, Eye, Gift, HeartPulse, Landmark, PiggyBank, Receipt, Scale, UserCheck } from 'lucide-react';
import { Skeleton } from '../../../components/ui';
import { fetchCalcDefaultsApi } from '../../../api/payroll.api';
import { cn } from '../../../lib/utils';
import { NumberChip, PillGroup, RuleCard, Switch, Tag } from './bits';

/**
 * Settings → Payroll → Calculation: every value the law or the standard sets,
 * which a company may change for itself (owner, 3 Nov 2026 — SaaS: companies
 * calculate in their own way). Empty means "the law", so the company follows
 * the law as it changes; a changed value is marked, used for draft payslips
 * from then on, recorded on each payslip and warned about there. Saved as the
 * payroll_calc setting; the server keeps only values it can use.
 */

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const shown = (v, unit) => {
  if (unit === '₹') return money(v);
  return unit === '%' ? `${v}%` : String(v);
};
const Note = ({ children }) => <p className="mt-2 text-[11px] text-fg-subtle">{children}</p>;

/** One value the law sets: the law's value, or the company's own with a warning. */
function LawValue({
  label, law, value, onChange, unit = '%', min = 0, max = 100, step = 0.01, integer = false, hint, tag = 'Law',
}) {
  // Whole numbers where the server keeps only whole numbers (days, years, rupee limits).
  const commit = (n) => onChange(integer ? Math.round(n) : Math.round(n * 100) / 100);
  const own = value !== null && value !== undefined;
  const differs = own && Number(value) !== Number(law);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{label}</p>
        <p className="text-[11px] text-fg-subtle">{tag}: {law == null ? '—' : shown(law, unit)}{hint ? ` · ${hint}` : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        {!own ? (
          <>
            <Tag tone="good">{tag}</Tag>
            <button type="button" disabled={law == null} className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-40" onClick={() => onChange(law)}>
              Change
            </button>
          </>
        ) : (
          <>
            <NumberChip
              value={Number(value)}
              min={min}
              max={max}
              step={step}
              prefix={unit === '₹' ? '₹' : undefined}
              suffix={unit === '%' ? '%' : undefined}
              width={unit === '₹' ? 'w-24' : 'w-14'}
              onCommit={commit}
              ariaLabel={label}
            />
            {differs && <Tag tone="warn">Not the {tag === 'Law' ? 'law' : 'standard'}</Tag>}
            <button type="button" className="text-[11px] text-fg-subtle hover:underline" onClick={() => onChange(null)}>
              Use the {tag === 'Law' ? 'law' : 'standard'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** An on/off choice with the standard beside it. */
function StandardSwitch({ label, help, standard, value, onChange }) {
  const current = value ?? standard;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{label}</p>
        {help && <p className="text-[11px] text-fg-subtle">{help}</p>}
      </div>
      <div className="flex items-center gap-2">
        {value != null && value !== standard && <Tag tone="warn">Not the standard</Tag>}
        <Switch checked={current} onChange={(v) => onChange(v === standard ? null : v)} label={['No', 'Yes']} ariaLabel={label} />
      </div>
    </div>
  );
}

export function CalculationCards({ calc, onChange, customOptions = [] }) {
  const { data: defaults, isLoading, error } = useQuery({
    queryKey: ['payroll', 'calc-defaults'],
    queryFn: fetchCalcDefaultsApi,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const c = calc && typeof calc === 'object' ? calc : {};
  const set = (group, key) => (v) => onChange({ ...c, [group]: { ...(c[group] || {}), [key]: v } });

  if (isLoading) return <Skeleton className="h-64 rounded-3xl" />;
  if (error || !defaults) return <p className="text-sm text-fg-muted">{error?.message || 'The legal values could not be loaded — try again.'}</p>;

  const std = defaults.standard;
  const pf = c.pf || {};
  const esi = c.esi || {};
  const wageCodes = c.wages?.components || std.wages.components;
  const fiftyPercent = c.wages?.fiftyPercentRule ?? std.wages.fiftyPercentRule;
  const allowances = customOptions
    .filter((o) => o && o.active !== false && ['allowance', 'earning'].includes(String(o.kind || '').toLowerCase()) && String(o.name || '').trim() && o.id)
    .map((o) => ({ code: `ALLOW:${o.id}`, name: String(o.name).trim() }));
  const parts = [...defaults.components, ...allowances];
  const toggleWage = (code) => {
    if (code === 'BASIC') return;
    const next = wageCodes.includes(code) ? wageCodes.filter((x) => x !== code) : [...wageCodes, code];
    const same = next.length === std.wages.components.length && next.every((x) => std.wages.components.includes(x));
    set('wages', 'components')(same ? null : next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-warning/30 bg-warning/5 p-3 text-xs text-fg-muted">
        Every value starts at the law (as of {defaults.asOf}) and follows it when it changes. Change one only where your company really works
        differently — for example the 10% PF rate some establishments have. A changed value is used for draft payslips from then on, is printed
        beside the law&apos;s value on each payslip&apos;s record, and payroll warns about it. Published payslips never change.
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <RuleCard icon={Landmark} tone="primary" title="PF values" summary="The rates and the wage limit PF is worked out with">
          <LawValue label="Employee PF" law={defaults.pf?.employeeRate} value={pf.employeeRate} onChange={set('pf', 'employeeRate')} hint="10% for some establishments" />
          <LawValue label="Employer PF" law={defaults.pf?.employerRate} value={pf.employerRate} onChange={set('pf', 'employerRate')} />
          <LawValue label="Pension (EPS), part of the employer's share" law={defaults.pf?.epsRate} value={pf.epsRate} onChange={set('pf', 'epsRate')} />
          <LawValue label="EDLI" law={defaults.pf?.edliRate} value={pf.edliRate} onChange={set('pf', 'edliRate')} />
          <LawValue label="EPF admin charges" law={defaults.pf?.adminRate} value={pf.adminRate} onChange={set('pf', 'adminRate')} />
          <LawValue label="PF wage limit (a month)" law={defaults.pf?.wageCeiling} value={pf.wageCeiling} onChange={set('pf', 'wageCeiling')} unit="₹" min={1} max={10000000} step={500} integer hint="with “Up to the legal limit”" />
          <Note>The pension (EPS) and EDLI always stay on the legal limit: PF counted on more goes into EPF.</Note>
        </RuleCard>

        <RuleCard icon={HeartPulse} tone="rose" title="ESI values" summary="The rates and limits ESI is worked out with">
          <LawValue label="Employee ESI" law={defaults.esi?.employeeRate} value={esi.employeeRate} onChange={set('esi', 'employeeRate')} />
          <LawValue label="Employer ESI" law={defaults.esi?.employerRate} value={esi.employerRate} onChange={set('esi', 'employerRate')} />
          <LawValue label="Covered up to (monthly pay)" law={defaults.esi?.coverageCeiling} value={esi.coverageCeiling} onChange={set('esi', 'coverageCeiling')} unit="₹" min={1} max={10000000} step={500} integer />
          <LawValue label="Covered up to, persons with disability" law={defaults.esi?.pwdCoverageCeiling} value={esi.pwdCoverageCeiling} onChange={set('esi', 'pwdCoverageCeiling')} unit="₹" min={1} max={10000000} step={500} integer />
          <LawValue label="No employee share up to (a day)" law={defaults.esi?.exemptDailyWage} value={esi.exemptDailyWage} onChange={set('esi', 'exemptDailyWage')} unit="₹" max={100000} step={1} integer />
        </RuleCard>

        <RuleCard
          icon={Scale}
          tone="violet"
          title="Wages for PF, gratuity and bonus"
          summary={fiftyPercent ? 'Labour Code wages, with the 50% rule' : 'The parts ticked below only (no 50% rule)'}
        >
          <p className="text-xs text-fg-muted">Which parts of pay count as wages:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {parts.map((p) => {
              const on = wageCodes.includes(p.code);
              return (
                <button
                  key={p.code}
                  type="button"
                  aria-pressed={on}
                  disabled={p.code === 'BASIC'}
                  onClick={() => toggleWage(p.code)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors',
                    on ? 'bg-primary/10 text-primary ring-primary/30' : 'bg-card text-fg-muted ring-border hover:text-fg',
                    p.code === 'BASIC' && 'cursor-not-allowed opacity-80',
                  )}
                >
                  {on ? '✓ ' : ''}{p.name}
                </button>
              );
            })}
          </div>
          <div className="mt-3">
            <StandardSwitch
              label="Labour Code 50% rule"
              help="The rest of the pay (HRA, allowances, overtime) may stay outside wages only up to half of the total; the excess counts as wages. In force since 21 Nov 2025."
              standard={std.wages.fiftyPercentRule}
              value={c.wages?.fiftyPercentRule ?? null}
              onChange={set('wages', 'fiftyPercentRule')}
            />
          </div>
          <Note>The law: Basic + DA (and a retaining allowance). Whether a general Special Allowance is wages is a question for your labour-law advisor (Supreme Court, 2019).</Note>
        </RuleCard>

        <RuleCard icon={Receipt} tone="sky" title="Income tax (TDS)" summary="For employees who haven't chosen a regime">
          <PillGroup
            size="sm"
            ariaLabel="Default tax regime"
            value={c.tds?.defaultRegime || std.tds.defaultRegime}
            onChange={(v) => set('tds', 'defaultRegime')(v === std.tds.defaultRegime ? null : v)}
            options={[{ value: 'new', label: 'New regime (the law\'s default)' }, { value: 'old', label: 'Old regime' }]}
          />
          {c.tds?.defaultRegime === 'old' && <p className="mt-2 text-[11px] font-semibold text-warning">By law the new regime applies unless the employee chooses the old one.</p>}
          <Note>An employee&apos;s own choice (My Tax Declaration, or their Payroll setup) always wins.</Note>
        </RuleCard>

        <RuleCard icon={Calculator} tone="teal" title="Rounding" summary={(c.rounding?.earnings || std.rounding.earnings) === 'paise' ? 'Each part to the paisa; the total paid to the rupee' : 'Each earned part to the rupee'}>
          <PillGroup
            size="sm"
            ariaLabel="Rounding"
            value={c.rounding?.earnings || std.rounding.earnings}
            onChange={(v) => set('rounding', 'earnings')(v === std.rounding.earnings ? null : v)}
            options={[{ value: 'rupee', label: 'Each part to ₹1 (standard)' }, { value: 'paise', label: 'Keep paise, round the total' }]}
          />
          <Note>PF and TDS are rounded to the nearest rupee and ESI up to the next rupee either way, as the law says.</Note>
        </RuleCard>

        <RuleCard icon={PiggyBank} tone="amber" title="Cost to company (CTC)" summary="What the payslip's CTC adds to the pay">
          <StandardSwitch label="Employer PF, EDLI and admin" standard={std.ctc.employerPf} value={c.ctc?.employerPf ?? null} onChange={set('ctc', 'employerPf')} />
          <StandardSwitch label="Employer ESI" standard={std.ctc.employerEsi} value={c.ctc?.employerEsi ?? null} onChange={set('ctc', 'employerEsi')} />
          <StandardSwitch label="Gratuity provision" help="15/26 of a month's wages a year (about 4.81%)" standard={std.ctc.gratuity} value={c.ctc?.gratuity ?? null} onChange={set('ctc', 'gratuity')} />
          <StandardSwitch label="Statutory bonus" help="For those with wages up to the bonus limit" standard={std.ctc.bonus} value={c.ctc?.bonus ?? null} onChange={set('ctc', 'bonus')} />
          <LawValue
            label="New salaries from a CTC: Basic is"
            law={std.ctcTemplate.basicPercent}
            value={c.ctcTemplate?.basicPercent}
            onChange={set('ctcTemplate', 'basicPercent')}
            min={1}
            hint="of the CTC; HRA and DA by Salary structure"
            tag="Standard"
          />
          <Note>A CTC recorded on the employee&apos;s salary is shown as it is. Add/Edit Employee → Salary can fill a salary from a yearly CTC.</Note>
        </RuleCard>

        <RuleCard icon={Gift} tone="primary" title="Gratuity, bonus and leave encashment" summary="Used for the CTC, full and final settlement and bonus payouts">
          <LawValue label="Gratuity: days' wages per year" law={std.gratuity.daysPerYear} value={c.gratuity?.daysPerYear} onChange={set('gratuity', 'daysPerYear')} unit="" min={1} max={60} step={1} integer />
          <LawValue label="Gratuity: divided by" law={std.gratuity.divisor} value={c.gratuity?.divisor} onChange={set('gratuity', 'divisor')} unit="" min={1} max={31} step={1} integer hint="working days in a month" />
          <LawValue label="Gratuity: years of service needed" law={std.gratuity.minYears} value={c.gratuity?.minYears} onChange={set('gratuity', 'minYears')} unit="" max={10} step={1} integer />
          <LawValue label="Gratuity: most payable" law={std.gratuity.ceiling} value={c.gratuity?.ceiling} onChange={set('gratuity', 'ceiling')} unit="₹" min={1} max={100000000} step={10000} integer />
          <LawValue label="Bonus rate" law={std.bonus.percent} value={c.bonus?.percent} onChange={set('bonus', 'percent')} hint="8.33% to 20% by law" />
          <LawValue label="Bonus: wages up to (a month)" law={std.bonus.eligibilityCeiling} value={c.bonus?.eligibilityCeiling} onChange={set('bonus', 'eligibilityCeiling')} unit="₹" min={1} max={10000000} step={500} integer />
          <LawValue label="Bonus: worked out on at most" law={std.bonus.calculationCeiling} value={c.bonus?.calculationCeiling} onChange={set('bonus', 'calculationCeiling')} unit="₹" min={1} max={10000000} step={500} integer hint="or the minimum wage, if higher" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-2">
            <div>
              <p className="text-sm font-semibold text-fg">Minimum wage (a month)</p>
              <p className="text-[11px] text-fg-subtle">Your state&apos;s, if it is above {money(std.bonus.calculationCeiling)}</p>
            </div>
            <NumberChip value={Number(c.bonus?.minimumWage || 0)} min={0} max={10000000} step={500} prefix="₹" width="w-24" onCommit={(v) => set('bonus', 'minimumWage')(v > 0 ? Math.round(v) : null)} ariaLabel="Minimum wage a month" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p className="text-sm font-semibold text-fg">Leave encashment: a day&apos;s pay</p>
              <p className="text-[11px] text-fg-subtle">Company policy</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <PillGroup
                size="sm"
                ariaLabel="Leave encashment base"
                value={c.encashment?.base || std.encashment.base}
                onChange={(v) => set('encashment', 'base')(v === std.encashment.base ? null : v)}
                options={[{ value: 'basic_da', label: 'Basic + DA' }, { value: 'gross', label: 'Gross' }]}
              />
              ÷
              <NumberChip value={Number(c.encashment?.divisor || std.encashment.divisor)} min={1} max={31} step={1} width="w-10" onCommit={(v) => set('encashment', 'divisor')(Math.round(v) === std.encashment.divisor ? null : Math.round(v))} ariaLabel="Leave encashment divisor" />
            </div>
          </div>
        </RuleCard>

        <RuleCard icon={UserCheck} tone="violet" title="Approval before publishing" summary={(c.approval?.required ?? std.approval.required) ? 'A second person approves each payslip' : 'Payslips can be published straight away'}>
          <StandardSwitch
            label="A second person approves before publishing"
            help="Approve on Run Payroll; whoever approved a payslip can't publish it, and a payslip that changes after approval needs approving again."
            standard={std.approval.required}
            value={c.approval?.required ?? null}
            onChange={set('approval', 'required')}
          />
          <Note>Needs the SQL file 20261104_payroll_approval.sql to have been run.</Note>
        </RuleCard>

        <RuleCard icon={Eye} tone="teal" title="What the payslip shows" summary="For payslips generated from now on">
          <StandardSwitch label="Monthly rate beside each earned amount" standard={std.payslip.showRates} value={c.payslip?.showRates ?? null} onChange={set('payslip', 'showRates')} />
          <StandardSwitch label="Employer contributions" standard={std.payslip.showEmployer} value={c.payslip?.showEmployer ?? null} onChange={set('payslip', 'showEmployer')} />
          <StandardSwitch label="Income-tax working" standard={std.payslip.showTaxWorking} value={c.payslip?.showTaxWorking ?? null} onChange={set('payslip', 'showTaxWorking')} />
        </RuleCard>
      </div>
    </div>
  );
}
