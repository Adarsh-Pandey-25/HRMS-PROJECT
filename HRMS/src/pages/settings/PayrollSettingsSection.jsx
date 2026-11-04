import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Coins, Gauge, Layers, ReceiptText, Rocket } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { SaveStatusIndicator } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateSettingApi } from '../../api/settings.api';
import { recalculatePayslipsFromSettingsApi, savePayrollRulesApi } from '../../api/payroll.api';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { DEFAULT_SALARY_COMPONENTS } from '../../lib/payrollComponents';
import { cn, formatCurrency } from '../../lib/utils';
import {
  countWorkingDays, describeWorkWeek, normalizePayRules, normalizeWorkWeek,
} from '../../lib/payRules';
import { useAutosave } from '../../hooks/useAutosave';
import { useEmployees } from '../../hooks/useEmployees';
import {
  DayRateCard, EarlyLeaveCard, LateRuleCard, LeaveFirstCard, MissedCheckoutCard, OvertimeCard, WeeklyOffsCard,
} from './payroll/PayRules';
import { CustomOptions, StatutoryCards } from './payroll/Deductions';
import { CalculationCards } from './payroll/Calculation';
import { RunCards, StructureCard } from './payroll/StructureRun';
import { PaySimulator } from './payroll/PaySimulator';

const TABS = [
  { id: 'rules', label: 'Pay rules', icon: Gauge },
  { id: 'deductions', label: 'Deductions', icon: ReceiptText },
  { id: 'calculation', label: 'Calculation', icon: Calculator },
  { id: 'structure', label: 'Salary structure', icon: Layers },
  { id: 'run', label: 'Run & automation', icon: Rocket },
];

/** The form, from what's stored — every field normalized so nothing renders undefined. */
const formFrom = (cfg, leaveFirst) => ({
  ...cfg,
  // The company's own choices; null = not chosen yet. Its own values for what
  // the law sets (rates, limits, wages, CTC) are in `calc` (null = the law).
  calc: cfg.calc && typeof cfg.calc === 'object' ? cfg.calc : {},
  pfPolicy: ['not_applicable', 'statutory_ceiling', 'full_wages'].includes(cfg.pfPolicy) ? cfg.pfPolicy : null,
  esiApplicable: typeof cfg.esiApplicable === 'boolean' ? cfg.esiApplicable : null,
  tdsPolicy: ['fixed_per_employee', 'projected', 'none'].includes(cfg.tdsPolicy) ? cfg.tdsPolicy : 'fixed_per_employee',
  ptState: cfg.ptState || '',
  // A state is a real choice once picked on this screen; the earlier screen
  // saved Karnataka by itself, so that one waits to be confirmed.
  ptStateSet: Boolean(cfg.ptStateSet) || Boolean(cfg.ptState && cfg.ptState !== 'Karnataka'),
  ptManualAmount: cfg.ptManualAmount == null || cfg.ptManualAmount === '' ? null : Number(cfg.ptManualAmount),
  ptManualSlabs: Array.isArray(cfg.ptManualSlabs) && cfg.ptManualSlabs.length ? cfg.ptManualSlabs : null,
  // Slabs for other states staff work in, where SpaxSync has no table: [{ state, slabs }].
  ptOtherStates: Array.isArray(cfg.ptOtherStates) ? cfg.ptOtherStates : [],
  // Labour Welfare Fund per state, as the company entered it: [{ state, employee, employer, months }].
  lwfStates: Array.isArray(cfg.lwfStates) ? cfg.lwfStates : [],
  workingDaysPerMonth: Number(cfg.workingDaysPerMonth ?? 26),
  runDate: Math.min(10, Math.max(1, Number(cfg.runDate) || 1)),
  components: cfg.components || DEFAULT_SALARY_COMPONENTS,
  customPayrollOptions: cfg.customPayrollOptions || [],
  rules: normalizePayRules(cfg.rules),
  workWeek: normalizeWorkWeek(cfg.workWeek),
  halfDayBeforeGoal: Boolean(cfg.halfDayBeforeGoal),
  leaveFirst: Boolean(leaveFirst),
});

/** Each group of settings is saved on its own, and only when it changed. */
const GROUPS = {
  base: (f) => ({
    workingDays: f.workingDaysPerMonth,
    config: {
      // Only what the company chooses. A choice not made yet is left out, so
      // payroll keeps using the default the server reports for it.
      ...(f.pfPolicy ? { pf_policy: f.pfPolicy } : {}),
      ...(typeof f.esiApplicable === 'boolean' ? { esi_applicable: f.esiApplicable } : {}),
      tds_policy: f.tdsPolicy,
      pt_state: f.ptState || '',
      pt_state_set: Boolean(f.ptState) && Boolean(f.ptStateSet),
      pt_manual_amount: f.ptManualAmount == null ? null : Number(f.ptManualAmount),
      pt_manual_slabs: f.ptManualSlabs ? f.ptManualSlabs.map((r) => ({
        from: Number(r.from) || 0,
        amount: Number(r.amount) || 0,
        february_amount: r.february_amount == null ? null : Number(r.february_amount),
      })) : null,
      lwf_states: (f.lwfStates || []).map((o) => ({
        state: o.state,
        employee: Number(o.employee) || 0,
        employer: Number(o.employer) || 0,
        months: (o.months || []).map(Number),
      })),
      pt_other_states: (f.ptOtherStates || []).map((o) => ({
        state: o.state,
        slabs: (o.slabs || []).map((r) => ({
          from: Number(r.from) || 0,
          amount: Number(r.amount) || 0,
          february_amount: r.february_amount == null ? null : Number(r.february_amount),
        })),
      })),
      components: f.components || DEFAULT_SALARY_COMPONENTS,
      hra_percent: f.hraPercent ?? 40,
      da_percent: f.daPercent ?? 10,
      run_date: Math.min(10, Math.max(1, Number(f.runDate) || 1)),
      auto_process: Boolean(f.autoProcess),
      custom_payroll_options: (f.customPayrollOptions || []).map((o) => ({
        id: o.id, name: o.name, kind: o.kind, value_type: o.valueType, value: o.value, base: o.base, active: o.active !== false,
      })),
    },
  }),
  rules: (f) => ({ rules: f.rules, leaveFirst: f.leaveFirst }),
  calc: (f) => f.calc,
  workWeek: (f) => f.workWeek,
  early: (f) => f.halfDayBeforeGoal,
};
const snapshot = (f) => Object.fromEntries(Object.entries(GROUPS).map(([k, fn]) => [k, JSON.stringify(fn(f))]));

/** What the simulator sends — the settings on screen, saved or not. */
const simulatorOverrides = (f) => ({
  rules: f.rules,
  workWeek: f.workWeek,
  leaveFirst: f.leaveFirst,
  ...(f.pfPolicy ? { pfPolicy: f.pfPolicy } : {}),
  ...(typeof f.esiApplicable === 'boolean' ? { esiApplicable: f.esiApplicable } : {}),
  tdsPolicy: f.tdsPolicy,
  ptState: f.ptState || '',
  ptManualAmount: f.ptManualAmount == null ? null : f.ptManualAmount,
  ptManualSlabs: f.ptManualSlabs || null,
  ptOtherStates: f.ptOtherStates || [],
  lwfStates: f.lwfStates || [],
  workingDaysSetting: f.workingDaysPerMonth,
  customOptions: f.customPayrollOptions,
  calc: f.calc,
  // The salary structure: how a sample salary is split.
  components: f.components,
  hraPercent: f.hraPercent,
  daPercent: f.daPercent,
});

/**
 * Settings → Payroll ("Payroll studio"). Everything autosaves; open draft
 * payslips are recalculated on the server in the background, and the pay
 * simulator previews any change before it's even saved.
 */
export function PayrollSettingsSection() {
  const queryClient = useQueryClient();
  const cfg = useSettingsStore((s) => s.payrollConfig);
  const leaveFirstStored = useSettingsStore((s) => s.leavePolicy?.autoDeduct);
  const update = useSettingsStore((s) => s.updatePayrollConfig);
  const updateLeavePolicy = useSettingsStore((s) => s.updateLeavePolicy);
  const { employees } = useEmployees();
  const [tab, setTab] = useState('rules');
  const [form, setForm] = useState(() => formFrom(cfg, leaveFirstStored));
  const savedRef = useRef(snapshot(formFrom(cfg, leaveFirstStored)));
  const markSavedRef = useRef(null);

  // Rehydrate after the server's settings load — and note them as saved, so
  // nothing re-saves until something actually changes.
  useEffect(() => {
    const loaded = formFrom(cfg, leaveFirstStored);
    setForm(loaded);
    savedRef.current = snapshot(loaded);
    markSavedRef.current?.(loaded);
  }, [cfg, leaveFirstStored]);

  const doSave = useCallback(async (next) => {
    const snap = snapshot(next);
    const changed = Object.keys(GROUPS).filter((k) => snap[k] !== savedRef.current[k]);
    if (!changed.length) return;
    const g = Object.fromEntries(Object.entries(GROUPS).map(([k, fn]) => [k, fn(next)]));
    const calls = [];
    if (changed.includes('base')) {
      calls.push(
        updateSettingApi('payroll_working_days', g.base.workingDays),
        updateSettingApi('payroll_config', g.base.config),
      );
    }
    if (changed.includes('rules')) {
      calls.push(savePayrollRulesApi(g.rules.rules, { leaveFirst: g.rules.leaveFirst }).then((res) => {
        if (res?.compOffEnabled) toast.success('Comp Off leave type switched on in Leave Policy');
      }));
    }
    // The server keeps only values payroll can use: show what it kept.
    let savedCalc = null;
    if (changed.includes('calc')) {
      calls.push(updateSettingApi('payroll_calc', g.calc).then((row) => {
        if (row?.value && typeof row.value === 'object') savedCalc = row.value;
      }));
    }
    if (changed.includes('workWeek')) calls.push(updateSettingApi('work_week', g.workWeek));
    if (changed.includes('early')) calls.push(updateSettingApi('payroll_halfday_before_goal_enabled', g.early));
    await Promise.all(calls);
    savedRef.current = { ...savedRef.current, ...Object.fromEntries(changed.map((k) => [k, snap[k]])) };

    const { leaveFirst, ...payrollPart } = next;
    update(savedCalc ? { ...payrollPart, calc: savedCalc } : payrollPart);
    if (changed.includes('rules')) updateLeavePolicy({ autoDeduct: leaveFirst });
    // Open payslips follow the new settings — the server does it in the background.
    recalculatePayslipsFromSettingsApi(undefined, undefined, undefined, { background: true })
      .catch((err) => toast.error(err.message || 'Payslips could not be refreshed; settings were still saved'));
    invalidateAndRefetch(queryClient, ['payroll']).catch(() => {});
  }, [queryClient, update, updateLeavePolicy]);

  const { status, save, retry, markSaved } = useAutosave(doSave);
  markSavedRef.current = markSaved;

  const patch = (partial) => setForm((prev) => {
    const next = typeof partial === 'function' ? partial(prev) : { ...prev, ...partial };
    save(next);
    return next;
  });
  const patchRules = (partial) => patch((prev) => ({ ...prev, rules: { ...prev.rules, ...partial } }));

  // Header summary: the whole policy in one line.
  const now = new Date();
  const working = countWorkingDays(now.getFullYear(), now.getMonth() + 1, form.workWeek);
  const divisor = form.rules.dayRateBasis === 'calendar'
    ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    : form.rules.dayRateBasis === 'fixed' ? form.workingDaysPerMonth : working;
  const perDay = 30000 / Math.max(1, divisor);
  const chips = useMemo(() => [
    { not_applicable: 'No PF', statutory_ceiling: 'PF up to the legal limit', full_wages: 'PF on full Basic + DA' }[form.pfPolicy] || 'PF: choose a method',
    form.ptState ? `PT: ${form.ptState}` : 'PT: choose a state',
    describeWorkWeek(form.workWeek),
    form.rules.late.enabled ? `Every ${form.rules.late.every} lates = ${form.rules.late.penalty === 'full' ? '1 day' : '½ day'}` : 'Lates free',
    form.rules.overtime.mode === 'pay' ? `OT paid ${form.rules.overtime.multiplier}×` : form.rules.overtime.mode === 'comp_off' ? 'OT → Comp Off' : 'OT not paid',
    form.leaveFirst ? 'Casual leave first' : 'Absence = LOP',
  ], [form.workWeek, form.rules, form.leaveFirst, form.pfPolicy, form.ptState]);

  const overrides = useMemo(() => simulatorOverrides(form), [form]);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-primary/15 via-card to-accent/10 p-6 shadow-card">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
              <Coins className="h-3.5 w-3.5" /> Payroll studio
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-fg">How your company pays</h2>
            <p className="mt-1 max-w-xl text-sm text-fg-muted">
              Every change saves on its own and updates draft payslips — a published payslip never changes. Try anything in the simulator first.
            </p>
          </div>
          <SaveStatusIndicator status={status} onRetry={retry} />
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-card/80 px-3 py-1 text-xs font-semibold text-fg shadow-sm ring-1 ring-border/60 backdrop-blur">{c}</span>
          ))}
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-on-primary shadow-sm">
            1 day = {formatCurrency(perDay)} on ₹30k
          </span>
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-1 overflow-x-auto px-1 py-1">
        <div role="tablist" aria-label="Payroll settings" className="inline-flex gap-1 rounded-2xl border border-border/70 bg-card/90 p-1 shadow-sm backdrop-blur">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold transition-all duration-200',
                  active ? 'bg-gradient-to-br from-primary to-teal text-white shadow-md' : 'text-fg-muted hover:bg-muted hover:text-fg',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {tab === 'rules' && (
            <>
              <LateRuleCard late={form.rules.late} onChange={(late) => patchRules({ late })} />
              <OvertimeCard overtime={form.rules.overtime} onChange={(overtime) => patchRules({ overtime })} perDay={perDay} />
              <WeeklyOffsCard workWeek={form.workWeek} onChange={(workWeek) => patch({ workWeek })} />
              <DayRateCard
                basis={form.rules.dayRateBasis}
                fixedDays={form.workingDaysPerMonth}
                workWeek={form.workWeek}
                onChange={(dayRateBasis) => patchRules({ dayRateBasis })}
                onFixedDays={(v) => patch({ workingDaysPerMonth: v })}
              />
              <LeaveFirstCard value={form.leaveFirst} onChange={(leaveFirst) => patch({ leaveFirst })} />
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <MissedCheckoutCard value={form.rules.missedCheckout} onChange={(missedCheckout) => patchRules({ missedCheckout })} />
                <EarlyLeaveCard value={form.halfDayBeforeGoal} onChange={(halfDayBeforeGoal) => patch({ halfDayBeforeGoal })} />
              </div>
            </>
          )}
          {tab === 'deductions' && (
            <>
              <StatutoryCards form={form} patch={patch} />
              <CustomOptions options={form.customPayrollOptions} onChange={(customPayrollOptions) => patch({ customPayrollOptions })} />
              <p className="px-1 text-xs text-fg-subtle">
                Want PF, ESI, PT, TDS or one of these off for one person? Open their profile → Payroll → Payroll setup.
              </p>
            </>
          )}
          {tab === 'calculation' && (
            <CalculationCards calc={form.calc} customOptions={form.customPayrollOptions} onChange={(calc) => patch({ calc })} />
          )}
          {tab === 'structure' && <StructureCard form={form} patch={patch} />}
          {tab === 'run' && <RunCards form={form} patch={patch} />}
        </div>
        <div className="xl:sticky xl:top-14 xl:self-start">
          <PaySimulator overrides={overrides} employees={employees} onEditStructure={() => setTab('structure')} />
        </div>
      </div>
    </div>
  );
}
