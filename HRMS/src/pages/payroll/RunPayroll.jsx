import { useMemo, useState } from 'react';
import { Wallet, Play, Check, Download, Eye } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, StatusBadge, DataTable, Avatar, Skeleton } from '../../components/ui';
import { PayslipPreviewModal } from '../../components/payroll/PayslipPreviewModal';
import { usePayrollMonth, useMonthPayslips, usePayrollMutations, downloadPayslipApi } from '../../hooks/usePayroll';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { useCompanyStore } from '../../store/companyStore';
import { formatCurrency, formatCompactINR, formatDate } from '../../lib/utils';
import { ExportButton } from '../../components/shared/ExportButton';
import toast from 'react-hot-toast';

export default function RunPayroll() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthLabel = formatDate(`${year}-${String(month).padStart(2, '0')}-01`, 'MMMM yyyy');

  const { data: payrollMonth, isLoading: loadingMonth, refetch: refetchMonth } = usePayrollMonth(month, year);
  const { data: payslips = [], isLoading: loadingPayslips, refetch: refetchPayslips } = useMonthPayslips(month, year);
  const { initMonth, generate, publish } = usePayrollMutations();
  const employeeMap = useEmployeeMap();
  const company = useCompanyStore((s) => s.company);
  const [processing, setProcessing] = useState(false);
  const [viewing, setViewing] = useState(null);

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
    try {
      let pm = payrollMonth;
      if (!pm?.id) {
        pm = await initMonth.mutateAsync({ month, year });
      }
      await generate.mutateAsync({ payrollMonthId: pm.id });
      await refetchPayslips();
      await refetchMonth();
      toast.success(`Payslips generated for ${totals.count || 'all'} employees`);
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
                <p className="font-medium text-fg">{e?.name || 'Employee'}</p>
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
      { accessorKey: 'payslipStatus', header: 'Status', cell: ({ getValue, row }) => <StatusBadge status={getValue() || row.original.status} /> },
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
    [employeeMap]
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

  const bankExportRows = useMemo(
    () => payslips.map((p) => ({
      employeeId: p.employeeId,
      name: employeeMap[p.employeeId]?.name || '',
      netPay: p.netPay || 0,
    })),
    [payslips, employeeMap]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Run Payroll" subtitle="Initialize, generate and publish monthly payslips via the backend payroll engine" />

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
          <Button icon={Play} size="sm" onClick={handleGenerate} disabled={processing || generate.isPending}>
            Generate Payslips
          </Button>
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
        <Card className="p-5 flex items-center justify-between">
          <p className="text-sm text-fg-muted">Bank transfer export</p>
          <ExportButton
            rows={bankExportRows}
            filename="bank-transfer-file"
            title="Bank Transfer File"
            columns={['employeeId', 'name', 'netPay']}
            label="Download bank file"
          />
        </Card>
      )}

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
