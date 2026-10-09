import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Gauge, Layers, ReceiptText, Rocket } from 'lucide-react';
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
import { RunCards, StructureCard } from './payroll/StructureRun';
import { PaySimulator } from './payroll/PaySimulator';

const TABS = [
  { id: 'rules', label: 'Pay rules', icon: Gauge },
  { id: 'deductions', label: 'Deductions', icon: ReceiptText },
  { id: 'structure', label: 'Salary structure', icon: Layers },
  { id: 'run', label: 'Run & automation', icon: Rocket },
];

/** The form, from what's stored — every field normalized so nothing renders undefined. */
const formFrom = (cfg, leaveFirst) => ({
  ...cfg,
  pfEmployeePercent: Number(cfg.pfEmployeePercent ?? 12),
  professionalTaxAmount: Number(cfg.professionalTaxAmount ?? 200),
  tdsPercent: Number(cfg.tdsPercent ?? 8),
  tdsMode: cfg.tdsMode || 'auto',
  esiEmployeePercent: Number(cfg.esiEmployeePercent ?? 0.75),
  esiThreshold: Number(cfg.esiThreshold ?? 21000),
  pfWageCeiling: cfg.pfWageCeiling == null || cfg.pfWageCeiling === '' ? null : Number(cfg.pfWageCeiling),
  workingDaysPerMonth: Number(cfg.workingDaysPerMonth ?? 26),
  runDate: Number(cfg.runDate ?? 25),
  autoLockDays: Number(cfg.autoLockDays ?? 20),
  bankFileFormat: cfg.bankFileFormat || 'NEFT',
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
    pf: f.pfEmployeePercent,
    pt: f.professionalTaxAmount,
    tds: f.tdsPercent,
    esi: f.esiEmployeePercent,
    esiThreshold: f.esiThreshold,
    config: {
      pf_employee_percent: f.pfEmployeePercent,
      professional_tax_amount: f.professionalTaxAmount,
      tds_percent: f.tdsPercent,
      tds_mode: f.tdsMode,
      pt_state: f.ptState ?? 'Karnataka',
      pf_wage_ceiling: f.pfWageCeiling ?? null,
      esi_employee_percent: f.esiEmployeePercent,
      esi_threshold: f.esiThreshold,
      components: f.components || DEFAULT_SALARY_COMPONENTS,
      hra_percent: f.hraPercent ?? 40,
      da_percent: f.daPercent ?? 10,
      run_date: Number(f.runDate) || 25,
      auto_process: Boolean(f.autoProcess),
      auto_lock_days: Number(f.autoLockDays) || 20,
      bank_file_format: f.bankFileFormat || 'NEFT',
      custom_payroll_options: (f.customPayrollOptions || []).map((o) => ({
        id: o.id, name: o.name, kind: o.kind, value_type: o.valueType, value: o.value, base: o.base, active: o.active !== false,
      })),
    },
  }),
  rules: (f) => ({ rules: f.rules, leaveFirst: f.leaveFirst }),
  workWeek: (f) => f.workWeek,
  early: (f) => f.halfDayBeforeGoal,
};
const snapshot = (f) => Object.fromEntries(Object.entries(GROUPS).map(([k, fn]) => [k, JSON.stringify(fn(f))]));

/** What the simulator sends — the settings on screen, saved or not. */
const simulatorOverrides = (f) => ({
  rules: f.rules,
  workWeek: f.workWeek,
  leaveFirst: f.leaveFirst,
  pfPercent: f.pfEmployeePercent,
  tdsPercent: f.tdsMode === 'manual' ? 0 : f.tdsPercent,
  esiPercent: f.esiEmployeePercent,
  esiThreshold: f.esiThreshold,
  ptAmount: f.professionalTaxAmount,
  ptState: f.ptState || '',
  pfWageCeiling: f.pfWageCeiling,
  workingDaysSetting: f.workingDaysPerMonth,
  customOptions: f.customPayrollOptions,
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
        updateSettingApi('payroll_pf_rate', g.base.pf / 100),
        updateSettingApi('payroll_professional_tax', g.base.pt),
        updateSettingApi('payroll_tds_percent', g.base.tds),
        updateSettingApi('payroll_esi_employee_percent', g.base.esi),
        updateSettingApi('payroll_esi_threshold', g.base.esiThreshold),
        updateSettingApi('payroll_config', g.base.config),
      );
    }
    if (changed.includes('rules')) {
      calls.push(savePayrollRulesApi(g.rules.rules, { leaveFirst: g.rules.leaveFirst }).then((res) => {
        if (res?.compOffEnabled) toast.success('Comp Off leave type switched on in Leave Policy');
      }));
    }
    if (changed.includes('workWeek')) calls.push(updateSettingApi('work_week', g.workWeek));
    if (changed.includes('early')) calls.push(updateSettingApi('payroll_halfday_before_goal_enabled', g.early));
    await Promise.all(calls);
    savedRef.current = { ...savedRef.current, ...Object.fromEntries(changed.map((k) => [k, snap[k]])) };

    const { leaveFirst, ...payrollPart } = next;
    update(payrollPart);
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
    describeWorkWeek(form.workWeek),
    form.rules.late.enabled ? `Every ${form.rules.late.every} lates = ${form.rules.late.penalty === 'full' ? '1 day' : '½ day'}` : 'Lates free',
    form.rules.overtime.mode === 'pay' ? `OT paid ${form.rules.overtime.multiplier}×` : form.rules.overtime.mode === 'comp_off' ? 'OT → Comp Off' : 'OT not paid',
    form.leaveFirst ? 'Casual leave first' : 'Absence = LOP',
  ], [form.workWeek, form.rules, form.leaveFirst]);

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
              Every change saves on its own and updates this month&apos;s draft payslips. Try anything in the simulator first.
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
          {tab === 'structure' && <StructureCard form={form} patch={patch} />}
          {tab === 'run' && <RunCards form={form} patch={patch} />}
        </div>
        <div className="xl:sticky xl:top-14 xl:self-start">
          <PaySimulator overrides={overrides} employees={employees} />
        </div>
      </div>
    </div>
  );
}
