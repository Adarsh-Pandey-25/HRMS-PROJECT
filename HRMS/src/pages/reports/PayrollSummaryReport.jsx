import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Card, CardHeader, Select, Avatar, DataTable, SkeletonTable, EmptyState, StatusBadge, SegmentedControl } from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { usePayrollSummaryReport } from '../../hooks/useReports';
import { useAuthStore } from '../../store/authStore';
import { DEPARTMENTS } from '../../lib/constants';
import { formatCurrency } from '../../lib/utils';
import { MONTH_OPTIONS, buildYearOptions, employeeName } from './reportUtils';

const GROUP_OPTIONS = [
  { value: 'employee', label: 'By Employee' },
  { value: 'department', label: 'By Department' },
];

export default function PayrollSummaryReport() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [department, setDepartment] = useState('');
  const [groupBy, setGroupBy] = useState('employee');

  const { data: rows = [], isLoading, isFetching } = usePayrollSummaryReport({ month, year, department, groupBy });

  const monthLabel = MONTH_OPTIONS.find((m) => m.value === month)?.label || '';

  const tableRows = useMemo(() => {
    if (groupBy === 'department') {
      return rows.map((r, i) => ({
        id: r.department || i,
        department: r.department || 'Unassigned',
        employeeCount: r.employeeCount ?? 0,
        grossSalary: r.grossSalary ?? 0,
        totalDeductions: r.totalDeductions ?? 0,
        netSalary: r.netSalary ?? 0,
        overtimePay: r.overtimePay ?? 0,
      }));
    }
    return rows.map((r) => ({
      id: r.employeeId,
      name: employeeName(r.employee),
      code: r.employee?.employeeCode || '',
      department: r.employee?.department || '—',
      grossSalary: r.grossSalary ?? 0,
      totalDeductions: r.totalDeductions ?? 0,
      netSalary: r.netSalary ?? 0,
      overtimePay: r.overtimePay ?? 0,
      status: r.payslipStatus || 'DRAFT',
    }));
  }, [rows, groupBy]);

  const employeeColumns = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Employee',
      cell: ({ row }) => (
        <div className="flex items-center gap-3 min-w-[170px]">
          <Avatar name={row.original.name} size="sm" />
          <div>
            <p className="font-medium text-fg">{row.original.name}</p>
            <p className="text-xs text-fg-subtle">{[row.original.code, row.original.department].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        </div>
      ),
    },
    { accessorKey: 'grossSalary', header: 'Gross', cell: ({ getValue }) => <span className="tabular-nums">{formatCurrency(getValue())}</span> },
    { accessorKey: 'totalDeductions', header: 'Deductions', cell: ({ getValue }) => <span className="tabular-nums text-danger">{formatCurrency(getValue())}</span> },
    { accessorKey: 'netSalary', header: 'Net Pay', cell: ({ getValue }) => <span className="tabular-nums font-semibold">{formatCurrency(getValue())}</span> },
    { accessorKey: 'overtimePay', header: 'Overtime', cell: ({ getValue }) => <span className="tabular-nums">{formatCurrency(getValue())}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
  ], []);

  const departmentColumns = useMemo(() => [
    { accessorKey: 'department', header: 'Department', cell: ({ getValue }) => <span className="font-medium text-fg">{getValue()}</span> },
    { accessorKey: 'employeeCount', header: 'Employees', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'grossSalary', header: 'Gross', cell: ({ getValue }) => <span className="tabular-nums">{formatCurrency(getValue())}</span> },
    { accessorKey: 'totalDeductions', header: 'Deductions', cell: ({ getValue }) => <span className="tabular-nums text-danger">{formatCurrency(getValue())}</span> },
    { accessorKey: 'netSalary', header: 'Net Pay', cell: ({ getValue }) => <span className="tabular-nums font-semibold">{formatCurrency(getValue())}</span> },
    { accessorKey: 'overtimePay', header: 'Overtime', cell: ({ getValue }) => <span className="tabular-nums">{formatCurrency(getValue())}</span> },
  ], []);

  const exportRows = useMemo(() => (groupBy === 'department'
    ? tableRows.map((r) => ({
      department: r.department,
      employees: r.employeeCount,
      gross: r.grossSalary,
      deductions: r.totalDeductions,
      net: r.netSalary,
      overtime: r.overtimePay,
    }))
    : tableRows.map((r) => ({
      employee: r.name,
      code: r.code,
      department: r.department,
      gross: r.grossSalary,
      deductions: r.totalDeductions,
      net: r.netSalary,
      overtime: r.overtimePay,
      status: r.status,
    }))), [tableRows, groupBy]);

  return (
    <Card>
      <CardHeader
        title={`Payroll Summary — ${monthLabel} ${year}`}
        subtitle={isLoading ? 'Loading…' : `${tableRows.length} ${groupBy === 'department' ? 'department' : 'employee'}${tableRows.length === 1 ? '' : 's'}`}
        action={(
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <SegmentedControl options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} />
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} options={MONTH_OPTIONS} className="w-36" aria-label="Month" />
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} options={buildYearOptions()} className="w-24" aria-label="Year" />
            {isHrAdmin && (
              <Select value={department} onChange={(e) => setDepartment(e.target.value)} options={DEPARTMENTS} placeholder="All departments" className="w-44" aria-label="Department" />
            )}
            <ExportButton
              rows={exportRows}
              filename={`payroll-summary-${year}-${String(month).padStart(2, '0')}`}
              title={`Payroll Summary — ${monthLabel} ${year}`}
              columns={groupBy === 'department'
                ? ['department', 'employees', 'gross', 'deductions', 'net', 'overtime']
                : ['employee', 'code', 'department', 'gross', 'deductions', 'net', 'overtime', 'status']}
            />
          </div>
        )}
      />
      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : tableRows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payroll data"
          message="No payslips have been generated yet for this month/year, or none match the selected department."
        />
      ) : (
        <div className={isFetching ? 'opacity-60 transition-opacity' : ''}>
          <DataTable columns={groupBy === 'department' ? departmentColumns : employeeColumns} data={tableRows} pageSize={10} />
        </div>
      )}
    </Card>
  );
}
