import { useMemo, useState } from 'react';
import {
  Wallet, Play, Check, Download, Eye, AlertTriangle, OctagonX, Info, CheckCircle2, Banknote,
} from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, StatusBadge, DataTable, Avatar, Skeleton } from '../../components/ui';
import { PayslipPreviewModal } from '../../components/payroll/PayslipPreviewModal';
import {
  usePayrollMonth, useMonthPayslips, usePayrollMutations, usePayrollChecks, downloadPayslipApi,
} from '../../hooks/usePayroll';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { useCompanyStore } from '../../store/companyStore';
import { cn, formatCurrency, formatCompactINR, formatDate } from '../../lib/utils';
import { ExportButton } from '../../components/shared/ExportButton';
import {
  applyAdjustmentsApi, approveMonthApi, downloadBankFileApi, downloadStatutoryFileApi, fetchAdjustmentsApi, fetchReconciliationApi, markPayslipsPaidApi,
} from '../../api/payroll.api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../../store/settingsStore';
import { EmployeeLink } from '../../components/shared/EmployeeLink';
import toast from 'react-hot-toast';

/** This month and the twelve before it; this month isn't over, so payroll for it can't run yet. */
function monthOptions() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    return {
      key: `${year}-${month}`,
      month,
      year,
      label: `${formatDate(`${year}-${String(month).padStart(2, '0')}-01`, 'MMMM yyyy')}${i === 0 ? ' (not over yet)' : ''}`,
    };
  });
}

const CHECK_STYLE = {
  block: { icon: OctagonX, box: 'bg-danger/10 text-danger' },
  warn: { icon: AlertTriangle, box: 'bg-warning/10 text-fg' },
  info: { icon: Info, box: 'bg-muted/60 text-fg-muted' },
};

/** What to sort out before generating — pending requests count as absences until decided. */
function PayrollChecks({ checks, loading }) {
  if (loading) return <Skeleton className="h-20 rounded-xl" />;
  if (!checks) return null;
  if (!checks.items.length) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" /> Ready — nothing pending for {checks.employeesInMonth} employees this month.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {checks.items.map((item) => {
        const s = CHECK_STYLE[item.level] || CHECK_STYLE.info;
        const Icon = s.icon;
        return (
          <div key={item.key} className={cn('rounded-xl px-4 py-3 text-sm', s.box)}>
            <p className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0" />{item.title}</p>
            {item.people?.length > 0 && (
              <p className="mt-1 pl-6 text-xs text-fg-muted">
                {item.people.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ', '}
                    <EmployeeLink employeeId={p.id}>{p.name}</EmployeeLink>
                  </span>
                ))}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const isPublished = (p) => String(p.payslipStatus || p.status || '').toLowerCase() === 'published';
const isPaid = (p) => String(p.paymentStatus || '').toLowerCase() === 'paid';

/**
 * Paying the month (report defect D11: publishing is not paying). The bank
 * file lists each published payslip's account, IFSC and net payable; once
 * the bank has paid, HR records the date and the bank's reference (UTR).
 */
function PaymentsCard({
  month, year, monthLabel, payslips, onPaid,
}) {
  const published = payslips.filter(isPublished);
  const unpaid = published.filter((p) => !isPaid(p));
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [reference, setReference] = useState('');

  const downloadBankFile = async () => {
    setBusy(true);
    try {
      const r = await downloadBankFileApi(month, year);
      if (r.skipped) toast.error(`Bank file: ${r.rows} payment${r.rows === 1 ? '' : 's'} (${formatCurrency(r.total)}); ${r.skipped} left out — no account number or IFSC`);
      else toast.success(`Bank file: ${r.rows} payment${r.rows === 1 ? '' : 's'}, ${formatCurrency(r.total)}`);
    } catch (err) {
      toast.error(err.message || 'Could not download the bank file');
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async () => {
    setBusy(true);
    try {
      const r = await markPayslipsPaidApi({ payslipIds: unpaid.map((p) => p.id), paidOn, reference: reference.trim() });
      if (r?.referenceStored === false) toast.success(`${r.updated} marked paid. The date and reference will be kept once the payment SQL file is run.`);
      else toast.success(`${r?.updated ?? unpaid.length} payslip${unpaid.length === 1 ? '' : 's'} marked paid`);
      setMarking(false);
      setReference('');
      await onPaid();
    } catch (err) {
      toast.error(err.message || 'Could not mark them paid');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Pay {monthLabel}</p>
          <p className="text-xs text-fg-subtle">
            {published.length} published · {published.length - unpaid.length} marked paid · {unpaid.length} still to pay
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon={Download} onClick={downloadBankFile} disabled={busy || !published.length}>
            Download bank file
          </Button>
          <Button size="sm" icon={Banknote} onClick={() => setMarking((v) => !v)} disabled={busy || !unpaid.length}>
            Mark paid…
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-fg-subtle">
        Upload the bank file as it is — opening and saving it in Excel can change long account numbers. Only published payslips are included.
      </p>
      {marking && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3">
          <label className="text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Paid on</span>
            <input type="date" value={paidOn} max={new Date().toLocaleDateString('en-CA')} onChange={(e) => setPaidOn(e.target.value)} className="h-9 rounded-xl border border-border bg-card px-2 text-sm text-fg" />
          </label>
          <label className="min-w-[220px] flex-1 text-xs text-fg-muted">
            <span className="mb-1 block font-semibold text-fg">Bank reference (UTR or batch number)</span>
            <input value={reference} maxLength={64} onChange={(e) => setReference(e.target.value)} className="h-9 w-full rounded-xl border border-border bg-card px-2 text-sm text-fg" placeholder="e.g. HDFCN26103012345" />
          </label>
          <Button size="sm" onClick={markPaid} loading={busy} disabled={reference.trim().length < 3 || !paidOn}>
            Mark {unpaid.length} paid
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * When the month's deposits are due (report §3.4–3.5): TDS by the 7th of the
 * next month, EPF (with the ECR) and ESI by the 15th. PT and LWF follow each
 * state's dates; March TDS: confirm with the CA.
 */
function DeadlinesNote({ month, year, monthLabel }) {
  const next = new Date(year, month, 1); // the month after the payroll month
  const due = (day) => formatDate(new Date(next.getFullYear(), next.getMonth(), day), 'dd MMM yyyy');
  return (
    <p className="rounded-2xl bg-muted/50 px-4 py-3 text-xs text-fg-muted">
      For {monthLabel}: deposit the TDS by <strong className="text-fg">{due(7)}</strong>; pay PF (upload the ECR) and ESI by{' '}
      <strong className="text-fg">{due(15)}</strong>. Professional Tax follows your state&apos;s dates.
      {month === 3 && ' March TDS: confirm the date with your CA (it was 30 April under the old rules).'}
    </p>
  );
}

/**
 * Changes after publishing: last month's published payslips worked out again
 * with today's attendance and salary history. A difference (an absence
 * corrected, a back-dated raise) goes on this month's payslip as arrears or a
 * recovery; the published payslip never changes.
 */
function AdjustmentsCard({ month, year }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['payroll', 'adjustments', month, year],
    queryFn: () => fetchAdjustmentsApi(month, year),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const items = data?.items || [];
  if (isLoading || error || !items.length) return null;
  const open = items.filter((i) => !i.added);
  const fromLabel = formatDate(`${data.from.year}-${String(data.from.month).padStart(2, '0')}-01`, 'MMMM yyyy');
  const add = async () => {
    setBusy(true);
    try {
      const r = await applyAdjustmentsApi(month, year, open.map((i) => i.employeeId));
      const n = r?.added?.length || 0;
      if (r?.skipped?.length) toast.error(`${n} added; ${r.skipped.length} not: ${r.skipped[0].reason}`);
      else toast.success(`${n} adjustment${n === 1 ? '' : 's'} added to this month`);
      await qc.invalidateQueries({ queryKey: ['payroll'] });
    } catch (err) {
      toast.error(err.message || 'Could not add them');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-fg">{fromLabel} pay changed since it was published</h3>
          <p className="text-xs text-fg-subtle">Worked out again with today's attendance and salary. The difference goes on this month's payslip; {fromLabel}'s stays as published. A change to pay settings since then shows here too — check each one.</p>
        </div>
        {open.length > 0 && (
          <Button size="sm" variant="outline" onClick={add} disabled={busy} loading={busy}>Add {open.length} to this month</Button>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {items.map((i) => (
          <div key={i.employeeId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2.5 text-sm">
            <span className="font-semibold text-fg">{i.name}</span>
            <span className="text-xs text-fg-muted">
              {i.paidDaysThen} → {i.paidDaysNow} paid days · {formatCurrency(i.paidThen)} → {formatCurrency(i.paidNow)} ·{' '}
              <span className={cn('font-semibold', i.difference > 0 ? 'text-success' : 'text-danger')}>{i.difference > 0 ? '+' : '−'}{formatCurrency(Math.abs(i.difference))}</span>
              {i.added ? ' · added' : ''}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The month's statutory upload files, from published payslips. */
function StatutoryFilesCard({ month, year, monthLabel }) {
  const [busy, setBusy] = useState(null);
  const download = async (kind) => {
    setBusy(kind);
    try {
      const r = await downloadStatutoryFileApi(kind, month, year);
      if (['register', 'journal', 'pt', 'lwf'].includes(kind)) return;
      const what = kind === 'ecr' ? 'EPF ECR' : 'ESI';
      const missing = kind === 'ecr' ? 'no UAN' : 'no ESIC number';
      if (r.skipped) toast.error(`${what}: ${r.rows} member${r.rows === 1 ? '' : 's'}; ${r.skipped} left out — ${missing} on their Payroll tab`);
      else toast.success(`${what}: ${r.rows} member${r.rows === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err.message || 'Could not download the file');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-fg">Files for {monthLabel}</p>
          <p className="text-xs text-fg-subtle">From published payslips. PF and ESI are due by the 15th of the next month; check each statutory file on its portal when you upload it.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon={Download} loading={busy === 'ecr'} disabled={Boolean(busy)} onClick={() => download('ecr')}>EPF ECR file</Button>
          <Button size="sm" variant="outline" icon={Download} loading={busy === 'esi'} disabled={Boolean(busy)} onClick={() => download('esi')}>ESI contribution data</Button>
          <Button size="sm" variant="outline" icon={Download} loading={busy === 'register'} disabled={Boolean(busy)} onClick={() => download('register')}>Salary register</Button>
          <Button size="sm" variant="outline" icon={Download} loading={busy === 'journal'} disabled={Boolean(busy)} onClick={() => download('journal')}>Accounting journal</Button>
          <Button size="sm" variant="outline" icon={Download} loading={busy === 'pt'} disabled={Boolean(busy)} onClick={() => download('pt')}>PT register</Button>
          <Button size="sm" variant="outline" icon={Download} loading={busy === 'lwf'} disabled={Boolean(busy)} onClick={() => download('lwf')}>LWF register</Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'check'}
            disabled={Boolean(busy)}
            onClick={async () => {
              setBusy('check');
              try {
                const r = await fetchReconciliationApi(month, year);
                if (r.agree) toast.success(`All agree: ${formatCurrency(r.totals.payslips)} on ${r.payslips} payslip${r.payslips === 1 ? '' : 's'} = register = bank file${r.totals.bankLeftOut ? ` + ${formatCurrency(r.totals.bankLeftOut)} left out` : ''} = journal`);
                else toast.error(r.issues.join(' '));
              } catch (err) {
                toast.error(err.message || 'Could not check the totals');
              } finally {
                setBusy(null);
              }
            }}
          >
            Check totals
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function RunPayroll() {
  const options = useMemo(() => monthOptions(), []);
  // Last month by default: a month's payroll runs once the month is over.
  const [periodKey, setPeriodKey] = useState(options[1].key);
  const period = options.find((o) => o.key === periodKey) || options[1];
  const { month, year } = period;
  const monthLabel = formatDate(`${year}-${String(month).padStart(2, '0')}-01`, 'MMMM yyyy');

  const { data: payrollMonth, isLoading: loadingMonth, refetch: refetchMonth } = usePayrollMonth(month, year);
  const { data: payslips = [], isLoading: loadingPayslips, refetch: refetchPayslips } = useMonthPayslips(month, year);
  const { data: checks, isLoading: loadingChecks } = usePayrollChecks(month, year);
  const { initMonth, generate, publish } = usePayrollMutations();
  const employeeMap = useEmployeeMap();
  const company = useCompanyStore((s) => s.company);
  const [processing, setProcessing] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const blocked = checks ? !checks.canGenerate : false;
  // Approval before publishing (Settings → Payroll → Calculation).
  const approvalRequired = useSettingsStore((s) => s.payrollConfig?.calc?.approval?.required === true);

  const totals = useMemo(() => {
    const gross = payslips.reduce((s, p) => s + Number(p.grossPay || 0), 0);
    const net = payslips.reduce((s, p) => s + Number(p.netPay || 0), 0);
    const deductions = payslips.reduce((s, p) => s + Number(p.deductions?.total || 0), 0);
    return { gross, net, deductions, count: payslips.length };
  }, [payslips]);

  const isProcessed = payslips.length > 0;
  const isLoading = loadingMonth || loadingPayslips;

  const handleInitialize = async () => {
    try {
      await initMonth.mutateAsync({ month, year });
      await refetchMonth();
      toast.success(`Payroll month initialized for ${monthLabel}`);
    } catch (err) {
      toast.error(err.message || 'Failed to initialize payroll month');
    }
  };

  const handleGenerate = async () => {
    setProcessing(true);
    setLastRun(null);
    try {
      let pm = payrollMonth;
      if (!pm?.id) {
        pm = await initMonth.mutateAsync({ month, year });
      }
      const results = await generate.mutateAsync({ payrollMonthId: pm.id });
      await refetchPayslips();
      await refetchMonth();
      const list = Array.isArray(results) ? results : [];
      const skipped = list.filter((r) => r.status === 'skipped');
      const generated = list.length - skipped.length;
      setLastRun({ generated, skipped });
      if (skipped.length) toast.error(`${generated} payslip${generated === 1 ? '' : 's'} generated; ${skipped.length} skipped — see below`);
      else toast.success(`${generated} payslip${generated === 1 ? '' : 's'} generated`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate payslips');
    } finally {
      setProcessing(false);
    }
  };

  const handlePublishAll = async () => {
    setProcessing(true);
    try {
      const drafts = payslips.filter((p) => {
        const st = String(p.payslipStatus || p.status || '').toLowerCase();
        return st !== 'published';
      });
      let published = 0;
      const errors = [];
      for (const p of drafts) {
        try {
          await publish.mutateAsync(p.id);
          published += 1;
        } catch (err) {
          errors.push(err.message || 'Publish failed');
        }
      }
      await refetchPayslips();
      if (errors.length && published === 0) {
        toast.error(errors[0]);
      } else if (errors.length) {
        toast.error(`Published ${published}; ${errors.length} failed: ${errors[0]}`);
      } else {
        toast.success(`All ${published} payslips published`);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleApproveAll = async () => {
    setProcessing(true);
    try {
      const res = await approveMonthApi(month, year);
      await refetchPayslips();
      const skipped = res?.skipped || [];
      if (skipped.length && !res.approved) toast.error(skipped[0].reason || 'Nothing could be approved');
      else if (skipped.length) toast.error(`Approved ${res.approved}; ${skipped.length} not approved: ${skipped[0].reason}`);
      else toast.success(`${res.approved} payslip${res.approved === 1 ? '' : 's'} approved — someone else can publish them now`);
    } catch (err) {
      toast.error(err.message || 'Could not approve the payslips');
    } finally {
      setProcessing(false);
    }
  };

  const openDownload = async (p) => {
    const st = String(p.payslipStatus || p.status || '').toLowerCase();
    if (st !== 'published') {
      toast.error('Publish the payslip before downloading the PDF');
      return;
    }
    try {
      await downloadPayslipApi(p.id);
    } catch (err) {
      toast.error(err.message || 'Failed to download payslip');
    }
  };

  const sheetColumns = useMemo(
    () => [
      {
        accessorKey: 'employeeId', header: 'Employee',
        cell: ({ getValue }) => {
          const e = employeeMap[getValue()];
          return (
            <div className="flex items-center gap-3">
              <Avatar name={e?.name || 'Employee'} size="sm" />
              <div>
                <p className="font-medium text-fg"><EmployeeLink employeeId={getValue()} tab="payroll">{e?.name || 'Employee'}</EmployeeLink></p>
                <p className="text-xs text-fg-subtle">{e?.department || '—'}</p>
              </div>
            </div>
          );
        },
      },
      { accessorFn: (r) => r.earnings?.basic, id: 'basic', header: 'Basic', cell: ({ getValue }) => formatCurrency(getValue() || 0) },
      { accessorFn: (r) => r.grossPay, id: 'gross', header: 'Gross', cell: ({ getValue }) => formatCurrency(getValue() || 0) },
      { accessorFn: (r) => r.deductions?.total, id: 'ded', header: 'Deductions', cell: ({ getValue }) => <span className="text-danger">{formatCurrency(getValue() || 0)}</span> },
      { accessorKey: 'netPay', header: 'Net', cell: ({ getValue }) => <span className="font-semibold">{formatCurrency(getValue() || 0)}</span> },
      {
        accessorKey: 'payslipStatus',
        header: 'Status',
        cell: ({ getValue, row }) => (
          <div className="flex flex-col items-start gap-0.5">
            <StatusBadge status={getValue() || row.original.status} />
            {approvalRequired && !isPublished(row.original) && (
              <span className={cn('text-[10px] font-semibold', row.original.approvalCurrent ? 'text-success' : 'text-warning')}>
                {row.original.approvalCurrent ? 'Approved' : 'Needs approval'}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'payment',
        header: 'Payment',
        cell: ({ row }) => {
          const p = row.original;
          if (!isPublished(p)) return <span className="text-xs text-fg-subtle">—</span>;
          if (!isPaid(p)) return <span className="text-xs text-warning">Not paid yet</span>;
          return (
            <span className="text-xs text-success">
              Paid{p.paymentReference ? ` · ${p.paymentReference}` : ''}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: 'Payslip',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={Eye}
                onClick={() => setViewing(p)}
                aria-label="View payslip"
              >
                View
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Download}
                onClick={() => openDownload(p)}
                aria-label="Download payslip PDF"
              />
            </div>
          );
        },
      },
    ],
    [employeeMap, approvalRequired]
  );

  const payrollExportRows = useMemo(
    () => payslips.map((p) => ({
      employee: employeeMap[p.employeeId]?.name || p.employeeId,
      department: employeeMap[p.employeeId]?.department || '',
      basic: p.earnings?.basic || 0,
      gross: p.grossPay || 0,
      deductions: p.deductions?.total || 0,
      net: p.netPay || 0,
      status: p.payslipStatus || p.status,
    })),
    [payslips, employeeMap]
  );


  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Run Payroll"
        subtitle="Generate a month's payslips once the month is over, review them, then publish"
        actions={(
          <select
            value={periodKey}
            aria-label="Payroll month"
            onChange={(e) => { setPeriodKey(e.target.value); setLastRun(null); }}
            className="h-10 rounded-input border border-border bg-card px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-primary"
          >
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
      />

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-fg">Before you generate {monthLabel}</p>
        <PayrollChecks checks={checks} loading={loadingChecks} />
        {lastRun?.skipped?.length > 0 && (
          <div className="mt-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-semibold">{lastRun.skipped.length} not generated:</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {lastRun.skipped.map((r) => (
                <li key={r.user_id}>
                  <EmployeeLink employeeId={r.user_id} tab="payroll">{employeeMap[r.user_id]?.name || 'Employee'}</EmployeeLink> — {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="h-11 flex flex-col justify-center gap-1">
            <p className="text-xs text-fg-subtle leading-none">Current run</p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-fg truncate leading-none">{monthLabel}</p>
              <StatusBadge status={payrollMonth?.status || 'pending'} className="shrink-0" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-fg mt-2">{formatCompactINR(totals.gross)}</p>
          <p className="text-xs text-fg-subtle mt-1">gross · {totals.count} payslips</p>
        </Card>
        <Card className="p-5">
          <div className="h-11 flex items-center">
            <p className="text-xs text-fg-subtle leading-none">Net payout</p>
          </div>
          <p className="text-2xl font-semibold text-fg mt-2">{formatCompactINR(totals.net)}</p>
        </Card>
        <Card className="p-5">
          <div className="h-11 flex items-center">
            <p className="text-xs text-fg-subtle leading-none">Total deductions</p>
          </div>
          <p className="text-2xl font-semibold text-fg mt-2">{formatCompactINR(totals.deductions)}</p>
        </Card>
        <Card className="p-5 flex flex-col justify-center gap-2">
          {!payrollMonth && (
            <Button variant="outline" size="sm" onClick={handleInitialize} disabled={initMonth.isPending}>
              Initialize Month
            </Button>
          )}
          <Button
            icon={Play}
            size="sm"
            onClick={handleGenerate}
            disabled={processing || generate.isPending || blocked}
            title={blocked ? 'Sort out the red items above first' : undefined}
          >
            Generate Payslips
          </Button>
          {isProcessed && approvalRequired && (
            <Button icon={Check} size="sm" variant="outline" onClick={handleApproveAll} disabled={processing}>
              Approve All
            </Button>
          )}
          {isProcessed && (
            <Button icon={Check} size="sm" variant="outline" onClick={handlePublishAll} disabled={processing}>
              Publish All
            </Button>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title={`Salary Sheet — ${monthLabel}`}
          subtitle="Figures calculated server-side from attendance, leave LOP, and payroll settings"
          action={
            <ExportButton
              rows={payrollExportRows}
              filename={`salary-sheet-${year}-${String(month).padStart(2, '0')}`}
              title={`Salary Sheet — ${monthLabel}`}
              columns={['employee', 'department', 'basic', 'gross', 'deductions', 'net', 'status']}
            />
          }
        />
        {isLoading ? (
          <Skeleton className="h-48 m-5 rounded-xl" />
        ) : payslips.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-muted">
            <Wallet className="h-10 w-10 mx-auto mb-3 text-fg-subtle" />
            No payslips yet. Initialize the month and click <strong>Generate Payslips</strong> to run payroll calculations.
          </div>
        ) : (
          <DataTable columns={sheetColumns} data={payslips} pageSize={10} />
        )}
      </Card>

      {isProcessed && (
        <PaymentsCard month={month} year={year} monthLabel={monthLabel} payslips={payslips} onPaid={refetchPayslips} />
      )}
      <AdjustmentsCard month={month} year={year} />
      {payslips.some(isPublished) && <StatutoryFilesCard month={month} year={year} monthLabel={monthLabel} />}
      {payslips.some(isPublished) && <DeadlinesNote month={month} year={year} monthLabel={monthLabel} />}

      <PayslipPreviewModal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        payslip={viewing}
        employeeName={employeeMap[viewing?.employeeId]?.name}
        employee={employeeMap[viewing?.employeeId]}
        company={company}
      />
    </div>
  );
}
