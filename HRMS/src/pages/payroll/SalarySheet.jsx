import { useMemo, useState } from 'react';
import { Download, Eye } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, Badge, Skeleton, DataTable } from '../../components/ui';
import { PayslipPreviewModal } from '../../components/payroll/PayslipPreviewModal';
import { useMonthPayslips, downloadPayslipApi } from '../../hooks/usePayroll';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { useCompanyStore } from '../../store/companyStore';
import { formatCurrency, formatDate } from '../../lib/utils';
import { ExportButton } from '../../components/shared/ExportButton';
import toast from 'react-hot-toast';

export default function SalarySheet() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthLabel = formatDate(`${year}-${String(month).padStart(2, '0')}-01`, 'MMMM yyyy');

  const { data: payrollSheet = [], isLoading } = useMonthPayslips(month, year);
  const employeeMap = useEmployeeMap();
  const companyName = useCompanyStore((s) => s.company.name);
  const [viewing, setViewing] = useState(null);

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

  const columns = useMemo(() => [
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
    { accessorKey: 'netPay', header: 'Net Pay', cell: ({ getValue }) => <span className="font-semibold">{formatCurrency(getValue() || 0)}</span> },
    {
      accessorKey: 'unpaidLeaveDays', header: 'Flags',
      cell: ({ row }) => (row.original.unpaidLeaveDays > 0
        ? <Badge tone="warning">LOP · {row.original.unpaidLeaveDays}d</Badge>
        : <span className="text-fg-subtle text-xs">—</span>),
    },
    {
      id: 'actions',
      header: 'Payslip',
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={Eye} onClick={() => setViewing(p)} aria-label="View payslip">
              View
            </Button>
            <Button variant="ghost" size="sm" icon={Download} onClick={() => openDownload(p)} aria-label="Download payslip PDF" />
          </div>
        );
      },
    },
  ], [employeeMap]);

  const exportRows = useMemo(
    () => payrollSheet.map((p) => ({
      employee: employeeMap[p.employeeId]?.name || p.employeeId,
      department: employeeMap[p.employeeId]?.department || '',
      basic: p.earnings?.basic || 0,
      gross: p.grossPay || 0,
      deductions: p.deductions?.total || 0,
      net: p.netPay || 0,
      lopDays: p.unpaidLeaveDays || 0,
      status: p.payslipStatus || p.status,
    })),
    [payrollSheet, employeeMap]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Salary Sheet" subtitle="Current month's full salary breakdown by employee" />

      <Card>
        <CardHeader
          title={`${monthLabel} Salary Sheet`}
          subtitle={`${payrollSheet.length} employees`}
          action={
            <ExportButton
              rows={exportRows}
              filename={`salary-sheet-${year}-${String(month).padStart(2, '0')}`}
              title={`${monthLabel} Salary Sheet`}
              columns={['employee', 'department', 'basic', 'gross', 'deductions', 'net', 'lopDays', 'status']}
            />
          }
        />
        {isLoading ? <Skeleton className="h-48 m-5 rounded-xl" /> : <DataTable columns={columns} data={payrollSheet} pageSize={10} />}
      </Card>

      <PayslipPreviewModal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        payslip={viewing}
        employeeName={employeeMap[viewing?.employeeId]?.name}
        companyName={companyName}
      />
    </div>
  );
}
