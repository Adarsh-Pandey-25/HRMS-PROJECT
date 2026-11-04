import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Download, Landmark, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, CardHeader, Button, Select, Skeleton, StatCard, Drawer,
} from '../../components/ui';
import { fetchTdsRegisterApi, downloadForm138Api, fetchAnnualTaxStatementApi } from '../../api/payroll.api';
import { AnnualTaxStatement } from '../../components/payroll/AnnualTaxStatement';
import { cn, formatCurrency, formatDate } from '../../lib/utils';

/** The tax year (April–March) today falls in, e.g. '2026-27', and the two before it. */
const taxYearOptions = () => {
  const now = new Date();
  const start = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return [start, start - 1, start - 2].map((y) => {
    const value = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    return { value, label: `${value} (Apr ${y} – Mar ${y + 1})` };
  });
};

/**
 * Payroll → TDS Register: the salary TDS deducted on published payslips —
 * each month's total to deposit (by the 7th of the next month), each
 * quarter's total and its deductee rows for the TDS statement (Form 138),
 * and each employee's year so far. Read-only.
 */
export default function TdsRegister() {
  const years = useMemo(taxYearOptions, []);
  const [taxYear, setTaxYear] = useState(years[0].value);
  const [downloading, setDownloading] = useState(null);
  const [statementFor, setStatementFor] = useState(null);
  const { data: statement, isLoading: loadingStatement, error: statementError } = useQuery({
    queryKey: ['payroll', 'tax-statement', statementFor?.employeeId, taxYear],
    queryFn: () => fetchAnnualTaxStatementApi(statementFor.employeeId, taxYear),
    enabled: Boolean(statementFor),
  });
  const { data: reg, isLoading, error } = useQuery({
    queryKey: ['payroll', 'tds-register', taxYear],
    queryFn: () => fetchTdsRegisterApi(taxYear),
  });

  const download = async (quarter) => {
    setDownloading(quarter);
    try {
      await downloadForm138Api(taxYear, quarter);
    } catch (err) {
      toast.error(err.message || 'Could not download the file');
    } finally {
      setDownloading(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="TDS Register"
        subtitle="Income tax deducted from salaries on published payslips — to deposit each month and report each quarter."
        actions={(
          <Select
            aria-label="Tax year"
            options={years}
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value)}
            className="w-56"
          />
        )}
      />

      {error && <Card className="p-5 text-sm text-danger">{error.message}</Card>}

      {isLoading || !reg ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label={`TDS deducted in ${reg.taxYear}`} value={formatCurrency(reg.totals.tds)} icon={Receipt} />
            <StatCard label="Salary paid (published payslips)" value={formatCurrency(reg.totals.gross)} icon={Landmark} tone="teal" />
            <StatCard label="Draft payslips not counted yet" value={String(reg.draftsNotCounted)} icon={CalendarClock} tone="warning" />
          </div>

          {reg.withoutPan > 0 && (
            <p className="flex items-start gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-sm text-fg">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {reg.withoutPan} {reg.withoutPan === 1 ? 'person had' : 'people had'} TDS deducted with no PAN recorded. Add it on their
              Payroll tab — without a PAN, the law can require TDS at a higher rate; check with your CA.
            </p>
          )}

          <Card>
            <CardHeader title="Each month" subtitle="Deposit each month's TDS by the 7th of the next month." />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="py-2">Month</th>
                    <th className="py-2 text-right">Payslips</th>
                    <th className="py-2 text-right">Salary paid</th>
                    <th className="py-2 text-right">TDS</th>
                    <th className="py-2 pl-4">Deposit by</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.months.map((m) => {
                    const due = m.tds > 0 && m.depositBy < today;
                    return (
                      <tr key={`${m.year}-${m.month}`} className="border-b border-border/60">
                        <td className="py-2 font-medium text-fg">
                          {m.label}
                          {m.drafts > 0 && <span className="ml-2 text-[11px] font-normal text-warning">{m.drafts} draft{m.drafts === 1 ? '' : 's'} not counted</span>}
                        </td>
                        <td className="py-2 text-right tabular-nums">{m.payslips}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(m.gross)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-fg">{formatCurrency(m.tds)}</td>
                        <td className={cn('py-2 pl-4 text-xs', due ? 'text-fg-muted' : 'text-fg-subtle')}>
                          {m.tds > 0 ? formatDate(m.depositBy, 'dd MMM yyyy') : '—'}
                          {m.depositToConfirm && m.tds > 0 && <span className="block text-[10px] text-warning">March: confirm the date with your CA</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Each quarter" subtitle="The quarterly TDS statement (Form 138, formerly 24Q). Download the deductee rows for your accountant or the return utility." />
            <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4">
              {reg.quarters.map((q) => (
                <div key={q.key} className="rounded-2xl border border-border/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{q.key} · {q.label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-fg">{formatCurrency(q.tds)}</p>
                  <p className="text-xs text-fg-subtle">{q.payslips} payslip{q.payslips === 1 ? '' : 's'} · {q.employees} employee{q.employees === 1 ? '' : 's'}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Download}
                    className="mt-3"
                    disabled={!q.payslips}
                    loading={downloading === q.key}
                    onClick={() => download(q.key)}
                  >
                    Form 138 data (CSV)
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Each employee" subtitle="TDS deducted so far this tax year — the basis for their annual certificate (Form 130, formerly Form 16)." />
            <div className="overflow-x-auto px-5 pb-5">
              {reg.employees.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-subtle">No published payslips in {reg.taxYear} yet.</p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-subtle">
                      <th className="py-2">Employee</th>
                      <th className="py-2">PAN</th>
                      <th className="py-2">Regime</th>
                      <th className="py-2 text-right">Salary paid</th>
                      <th className="py-2 text-right">TDS so far</th>
                      <th className="py-2 text-right">Year&apos;s tax (latest estimate)</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {reg.employees.map((e) => (
                      <tr key={e.employeeId} className="border-b border-border/60">
                        <td className="py-2">
                          <span className="font-medium text-fg">{e.name}</span>
                          {e.code && <span className="ml-2 text-xs text-fg-subtle">{e.code}</span>}
                        </td>
                        <td className={cn('py-2 font-mono text-xs', e.pan ? 'text-fg' : 'text-warning')}>{e.pan || 'Not recorded'}</td>
                        <td className="py-2 text-xs capitalize text-fg-muted">{e.regime ? `${e.regime} regime` : '—'}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(e.gross)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-fg">{formatCurrency(e.tds)}</td>
                        <td className="py-2 text-right tabular-nums text-fg-muted">{e.projectedAnnualTax != null ? formatCurrency(e.projectedAnnualTax) : '—'}</td>
                        <td className="py-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => setStatementFor(e)}>Statement</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      <Drawer
        open={Boolean(statementFor)}
        onClose={() => setStatementFor(null)}
        title={statementFor ? `${statementFor.name} — ${taxYear}` : ''}
        subtitle="Salary and tax on what was actually paid"
        width="w-[520px]"
      >
        {statementError && <p className="text-sm text-danger">{statementError.message}</p>}
        {loadingStatement ? <Skeleton className="h-64 w-full rounded-xl" /> : <AnnualTaxStatement s={statement} />}
      </Drawer>
    </div>
  );
}
