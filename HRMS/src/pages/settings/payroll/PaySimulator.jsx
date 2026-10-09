import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Loader2, RotateCcw, User, Wand2 } from 'lucide-react';
import { cn, formatCurrency, formatHours } from '../../../lib/utils';
import { simulatePayApi } from '../../../api/payroll.api';
import { NumberChip, PillGroup } from './bits';

const SEGMENTS = [
  { key: 'net', label: 'Take-home', color: 'bg-teal' },
  { key: 'LOP', label: 'Loss of pay', color: 'bg-danger' },
  { key: 'PF', label: 'PF', color: 'bg-violet-500' },
  { key: 'ESI', label: 'ESI', color: 'bg-pink-500' },
  { key: 'Professional Tax', label: 'PT', color: 'bg-sky-500' },
  { key: 'TDS', label: 'TDS', color: 'bg-warning' },
  { key: 'other', label: 'Other', color: 'bg-slate-400' },
];

const EMPTY_SCENARIO = { absent: 0, halfDays: 0, lates: 0, overtimeHours: 0 };
const PRESETS = [
  { label: 'Perfect month', s: EMPTY_SCENARIO },
  { label: '2 lates', s: { ...EMPTY_SCENARIO, lates: 2 } },
  { label: '4 lates', s: { ...EMPTY_SCENARIO, lates: 4 } },
  { label: 'Late daily', s: { ...EMPTY_SCENARIO, lates: 22 } },
  { label: '1 absent', s: { ...EMPTY_SCENARIO, absent: 1 } },
  { label: '+10h OT', s: { ...EMPTY_SCENARIO, overtimeHours: 10 } },
];

/**
 * "What would this month's pay be?" — for a sample salary or a real
 * employee, under the settings on screen (saved or not). The server runs the
 * same calculation real payslips use; nothing is stored.
 */
export function PaySimulator({ overrides, employees = [] }) {
  const [who, setWho] = useState('sample');
  const [gross, setGross] = useState(30000);
  const [employeeId, setEmployeeId] = useState('');
  const [scenario, setScenario] = useState(EMPTY_SCENARIO);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const overridesKey = JSON.stringify(overrides);
  useEffect(() => {
    if (who === 'employee' && !employeeId) return undefined;
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await simulatePayApi({
          ...(who === 'employee' ? { employeeId } : { gross }),
          scenario,
          overrides: JSON.parse(overridesKey),
        });
        if (id === seq.current) { setResult(data); setError(''); }
      } catch (err) {
        if (id === seq.current) setError(err.message || 'Could not work out the pay');
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [who, gross, employeeId, scenario, overridesKey]);

  const view = useMemo(() => {
    if (!result) return null;
    // Responses arrive camelCased (api/client.js).
    const totals = result.breakdownJson?.totals || {};
    const deductions = result.breakdownJson?.deductions || [];
    const cfg = result.breakdownJson?.config || {};
    const grossPay = Number(totals.grossSalary || 0);
    const by = Object.fromEntries(deductions.map((d) => [d.name, Number(d.amount || 0)]));
    const known = ['LOP', 'PF', 'ESI', 'Professional Tax', 'TDS'];
    const other = deductions.filter((d) => !known.includes(d.name)).reduce((s, d) => s + Number(d.amount || 0), 0);
    const parts = { net: Number(totals.netPay || 0), ...by, other };
    const segs = SEGMENTS.map((s) => ({ ...s, amount: parts[s.key] || 0 })).filter((s) => s.amount > 0);
    const hits = [];
    if (cfg.latePenaltyDays > 0) hits.push({ tone: 'bad', text: `${cfg.lateCount} lates → ${cfg.latePenaltyDays} day${cfg.latePenaltyDays === 1 ? '' : 's'} cut` });
    else if (cfg.lateCount > 0) hits.push({ tone: 'good', text: `${cfg.lateCount} late${cfg.lateCount === 1 ? '' : 's'} → no cut` });
    if (cfg.leaveCover?.days > 0) hits.push({ tone: 'good', text: `${cfg.leaveCover.days} day${cfg.leaveCover.days === 1 ? '' : 's'} covered by Casual Leave` });
    if (cfg.overtime?.pay > 0) hits.push({ tone: 'good', text: `${formatHours(cfg.overtime.hours)} overtime → +${formatCurrency(cfg.overtime.pay)}` });
    if (cfg.overtime?.compOffDays > 0) hits.push({ tone: 'good', text: `${formatHours(cfg.overtime.hours)} overtime → ${cfg.overtime.compOffDays} Comp Off day${cfg.overtime.compOffDays === 1 ? '' : 's'}` });
    if (cfg.overtime?.mode === 'off' && scenario.overtimeHours > 0) hits.push({ tone: 'neutral', text: 'Overtime is off — not paid' });
    return { grossPay, net: Number(totals.netPay || 0), segs, deductions, cfg, earnings: result.breakdownJson?.earnings || [], hits };
  }, [result, scenario.overtimeHours]);

  const setS = (k) => (v) => setScenario((s) => ({ ...s, [k]: v }));
  const activePreset = PRESETS.find((p) => JSON.stringify(p.s) === JSON.stringify(scenario));

  return (
    <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      <div className="relative bg-gradient-to-br from-ink-900 via-ink-800 to-primary-dark p-5 text-white">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-teal/30 blur-3xl" />
        <div className="relative flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
            <FlaskConical className="h-3.5 w-3.5" /> Pay simulator
          </p>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-white/70" />}
        </div>
        <p className="relative mt-3 text-[11px] text-white/60">Take-home this month</p>
        <p className="relative text-4xl font-extrabold tabular-nums tracking-tight transition-all">
          {view ? formatCurrency(view.net) : '—'}
        </p>
        {view && (
          <p className="relative mt-0.5 text-[11px] text-white/60">
            of {formatCurrency(view.grossPay)} gross · {view.cfg.workingDays} {view.cfg.dayRateBasis === 'calendar' ? 'calendar' : view.cfg.dayRateBasis === 'fixed' ? 'fixed' : 'working'} days · {formatCurrency(view.cfg.perDayRate)}/day
          </p>
        )}
        {view && view.grossPay > 0 && (
          <div className="relative mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
            {view.segs.map((s) => (
              <div key={s.key} className={cn('h-full transition-all duration-500', s.color)} style={{ width: `${(s.amount / view.grossPay) * 100}%` }} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 p-5">
        <PillGroup
          ariaLabel="Whose pay"
          value={who}
          onChange={setWho}
          options={[{ value: 'sample', label: 'Sample salary', icon: Wand2 }, { value: 'employee', label: 'An employee', icon: User }]}
        />
        {who === 'sample' ? (
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-fg-muted">Monthly gross</span>
              <span className="font-bold tabular-nums text-fg">{formatCurrency(gross)}</span>
            </div>
            <input
              type="range"
              min={5000}
              max={200000}
              step={1000}
              value={gross}
              aria-label="Monthly gross"
              onChange={(e) => setGross(Number(e.target.value))}
              className="mt-2 w-full accent-[rgb(var(--color-primary))]"
            />
          </div>
        ) : (
          <select
            value={employeeId}
            aria-label="Employee"
            onChange={(e) => setEmployeeId(e.target.value)}
            className="h-10 w-full rounded-input border border-border bg-card px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Pick an employee…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name || `${e.firstName || ''} ${e.lastName || ''}`.trim()}</option>)}
          </select>
        )}

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-fg-subtle">This month</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setScenario(p.s)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  activePreset === p ? 'bg-primary text-on-primary' : 'bg-muted text-fg-muted hover:text-fg',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-1.5 text-xs text-fg-muted">
            {[
              ['Absent days', 'absent', 31, 1],
              ['Half days', 'halfDays', 31, 1],
              ['Late arrivals', 'lates', 31, 1],
              ['Overtime hours', 'overtimeHours', 300, 1],
            ].map(([label, key, max, step]) => (
              <label key={key} className="flex items-center justify-between gap-2 rounded-2xl bg-muted/40 py-1 pl-3 pr-1">
                <span>{label}</span>
                <NumberChip value={scenario[key]} min={0} max={max} step={step} width="w-10" onCommit={setS(key)} ariaLabel={label} />
              </label>
            ))}
          </div>
          {activePreset !== PRESETS[0] && (
            <button type="button" onClick={() => setScenario(EMPTY_SCENARIO)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>

        {error && <p className="rounded-2xl bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        {who === 'employee' && !employeeId && <p className="text-xs text-fg-subtle">Pick someone to see their pay with their own deductions.</p>}

        {view && (
          <>
            {view.hits.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {view.hits.map((h) => (
                  <span key={h.text} className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', h.tone === 'bad' ? 'bg-danger/10 text-danger' : h.tone === 'good' ? 'bg-success/10 text-success' : 'bg-muted text-fg-muted')}>
                    {h.text}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-1 rounded-2xl bg-muted/30 p-3 text-xs">
              {view.earnings.map((e) => (
                <div key={`e-${e.name}`} className="flex justify-between text-fg-muted">
                  <span>{e.name}</span><span className="tabular-nums text-fg">{formatCurrency(e.amount)}</span>
                </div>
              ))}
              <div className="my-1 border-t border-dashed border-border" />
              {view.deductions.length === 0 && <p className="text-fg-subtle">No deductions</p>}
              {view.deductions.map((d) => {
                const seg = SEGMENTS.find((s) => s.key === d.name) || SEGMENTS[SEGMENTS.length - 1];
                return (
                  <div key={`d-${d.name}`} className="flex items-center justify-between text-fg-muted">
                    <span className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', seg.color)} />{d.name}</span>
                    <span className="tabular-nums text-danger">−{formatCurrency(d.amount)}</span>
                  </div>
                );
              })}
              <div className="mt-1 flex justify-between border-t border-border pt-1.5 text-sm font-bold text-fg">
                <span>Net pay</span><span className="tabular-nums">{formatCurrency(view.net)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
