import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, Badge, Skeleton, PageHeader } from '../../components/ui';
import { getStatutoryRulesApi } from '../../api/superAdmin.api';

/**
 * Super admin → Statutory rules: every legal value payroll uses, with its
 * source, effective dates and whether it is still to be confirmed with a CA
 * (docs/payroll-statutory-values.md). Read-only — the values change with a
 * reviewed release; each company can set its own in Settings → Payroll →
 * Calculation.
 */
const rs = (v) => (v == null ? 'no limit' : `₹${Number(v).toLocaleString('en-IN')}`);
const pc = (v) => (v == null ? '—' : `${v}%`);

function Status({ status }) {
  if (status === 'confirm') return <Badge tone="warning">to confirm</Badge>;
  if (status === 'company') return <Badge tone="info">company</Badge>;
  return <Badge tone="success">{status || 'established'}</Badge>;
}

function RuleHead({ r }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <span className="font-semibold text-fg">{r.id}</span>
      <span>{r.from} → {r.to || 'now'}</span>
      <Status status={r.status} />
      <span className="w-full text-[11px] text-fg-subtle">{r.source}</span>
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3 border-b border-border/40 py-1.5 text-sm last:border-0">
    <span className="text-fg-muted">{label}</span>
    <span className="font-semibold tabular-nums text-fg">{value}</span>
  </div>
);

export default function StatutoryRules() {
  const { data, isLoading, error } = useQuery({ queryKey: ['super-admin', 'statutory-rules'], queryFn: getStatutoryRulesApi });
  const [state, setState] = useState('Karnataka');
  const pt = useMemo(() => (data?.professionalTax || []).find((s) => s.state === state), [data, state]);

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (error || !data) return <p className="text-sm text-fg-muted">{error?.message || 'Could not load the rules.'}</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory rules"
        subtitle="The legal values payroll uses, with their sources. They change with a reviewed release; companies can set their own in Settings → Payroll → Calculation."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="EPF" />
          <div className="space-y-4 p-4">
            {data.epf.map((r) => (
              <div key={r.id}>
                <RuleHead r={r} />
                <Row label="Employee / employer" value={`${pc(r.employeeRate)} / ${pc(r.employerRate)}`} />
                <Row label="Pension (EPS) · EDLI · admin" value={`${pc(r.epsRate)} · ${pc(r.edliRate)} · ${pc(r.adminRate)} (min ${rs(r.adminMinimum)})`} />
                <Row label="Wage ceiling (EDLI)" value={`${rs(r.wageCeiling)} (${rs(r.edliWageCeiling)})`} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="ESI and overtime" />
          <div className="space-y-4 p-4">
            {data.esi.map((r) => (
              <div key={r.id}>
                <RuleHead r={r} />
                <Row label="Employee / employer" value={`${pc(r.employeeRate)} / ${pc(r.employerRate)}`} />
                <Row label="Covered up to (disability)" value={`${rs(r.coverageCeiling)} (${rs(r.pwdCoverageCeiling)})`} />
                <Row label="No employee share up to a day" value={rs(r.exemptDailyWage)} />
              </div>
            ))}
            {data.overtime.map((r) => (
              <div key={r.id}>
                <RuleHead r={r} />
                <Row label="Overtime at least" value={`${r.minimumMultiplier}× the normal rate`} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Income tax (TDS)" />
          <div className="space-y-4 p-4">
            {data.incomeTax.map((t) => (
              <div key={t.id}>
                <RuleHead r={t} />
                {Object.entries(t.regimes).map(([key, r]) => (
                  <div key={key} className="mt-2 rounded-xl bg-muted/30 p-2.5">
                    <p className="text-xs font-bold uppercase tracking-wide text-fg">{key} regime</p>
                    <Row label="Standard deduction" value={rs(r.standardDeduction)} />
                    <Row label="Slabs" value={r.slabs.map((s) => `${s.rate}% to ${rs(s.upTo)}`).join(' · ')} />
                    {r.rebate && <Row label="Rebate" value={`${rs(r.rebate.maxRebate)} up to ${rs(r.rebate.incomeUpTo)}${r.rebate.marginalRelief ? ', marginal relief' : ''}`} />}
                    <Row label="Surcharge" value={r.surcharge.map((s) => `${s.rate}% above ${rs(s.above)}`).join(' · ') || '—'} />
                    <Row label="Cess" value={pc(r.cess)} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Gratuity and statutory bonus" />
          <div className="space-y-4 p-4">
            {data.gratuity.map((r) => (
              <div key={r.id}>
                <RuleHead r={r} />
                <Row label="Wages × days ÷ divisor × years" value={`${r.daysPerYear} ÷ ${r.divisor}`} />
                <Row label="Years needed (fixed-term)" value={`${r.minYears} (${r.minYearsFixedTerm})`} />
                <Row label="Ceiling" value={rs(r.ceiling)} />
              </div>
            ))}
            {data.bonus.map((r) => (
              <div key={r.id}>
                <RuleHead r={r} />
                <Row label="Rate" value={`${pc(r.minPercent)} to ${pc(r.maxPercent)}`} />
                <Row label="For wages up to (worked out on at most)" value={`${rs(r.eligibilityCeiling)} (${rs(r.calculationCeiling)} or the minimum wage)`} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Professional Tax by state" />
          <div className="space-y-3 p-4">
            <select value={state} onChange={(e) => setState(e.target.value)} className="h-9 rounded-xl border border-border bg-card px-2 text-sm" aria-label="State">
              {data.professionalTax.map((s) => <option key={s.code} value={s.state}>{s.state}</option>)}
            </select>
            {pt && (
              <div>
                <p className="text-sm text-fg-muted">
                  {{
                    slab: 'SpaxSync applies the state\'s table.',
                    none: 'No Professional Tax in this state.',
                    manual: 'PT is levied, but SpaxSync has no table yet: each company enters its slabs.',
                    verify: 'Unclear whether PT applies: each company decides.',
                  }[pt.kind]}
                </p>
                {pt.tables.map((v) => (
                  <div key={v.id} className="mt-2">
                    <RuleHead r={v} />
                    <p className="mt-1 text-xs text-fg-subtle">{v.basis === 'half_yearly' ? 'On each half-year\'s income' : 'On each month\'s gross'}</p>
                    {v.slabs.map((s) => (
                      <Row key={`${s.upTo}`} label={`Up to ${rs(s.upTo)}`} value={`${rs(s.amount)}${s.februaryAmount != null ? ` (February ${rs(s.februaryAmount)})` : ''}`} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
