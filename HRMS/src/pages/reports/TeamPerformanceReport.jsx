import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Card, CardHeader, Select, Avatar, DataTable, SkeletonTable, EmptyState, Badge } from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { useTeamPerformanceReport } from '../../hooks/useReports';
import { useAuthStore } from '../../store/authStore';
import { DEPARTMENTS } from '../../lib/constants';
import { formatCurrency } from '../../lib/utils';
import { MONTH_OPTIONS, buildYearOptions, employeeName } from './reportUtils';

export default function TeamPerformanceReport() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [department, setDepartment] = useState('');

  const { data: rows = [], isLoading, isFetching } = useTeamPerformanceReport({ month, year, department });

  const monthLabel = MONTH_OPTIONS.find((m) => m.value === month)?.label || '';

  const tableRows = useMemo(() => rows.map((r) => ({
    id: r.employee?.id,
    name: employeeName(r.employee),
    code: r.employee?.employeeCode || '',
    department: r.employee?.department || '—',
    designation: r.employee?.designation || '',
    present: r.attendance?.present ?? 0,
    wfh: r.attendance?.wfh ?? 0,
    late: r.attendance?.late ?? 0,
    halfDay: r.attendance?.halfDay ?? 0,
    absent: r.attendance?.absent ?? 0,
    onLeave: r.attendance?.onApprovedLeave ?? 0,
    totalHours: r.attendance?.totalHours ?? 0,
    overtimeHours: r.attendance?.overtimeHours ?? 0,
    leaveRequests: r.leaves?.total ?? 0,
    leavePending: r.leaves?.pending ?? 0,
    leaveApprovedDays: r.leaves?.approvedDays ?? 0,
    reimbursementCount: r.reimbursements?.total ?? 0,
    reimbursementAmount: r.reimbursements?.totalAmount ?? 0,
  })), [rows]);

  const columns = useMemo(() => [
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
    { accessorKey: 'present', header: 'Present', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'wfh', header: 'WFH', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'late', header: 'Late', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'absent', header: 'Absent', cell: ({ getValue }) => <span className={getValue() > 0 ? 'tabular-nums text-danger font-medium' : 'tabular-nums'}>{getValue()}</span> },
    { accessorKey: 'onLeave', header: 'On Leave', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'totalHours', header: 'Total Hrs', cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() || 0).toFixed(1)}</span> },
    { accessorKey: 'overtimeHours', header: 'OT Hrs', cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() || 0).toFixed(1)}</span> },
    {
      accessorKey: 'leaveRequests',
      header: 'Leave Requests',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="tabular-nums">{row.original.leaveRequests}</span>
          {row.original.leavePending > 0 && <Badge tone="warning">{row.original.leavePending} pending</Badge>}
        </div>
      ),
    },
    {
      accessorKey: 'reimbursementAmount',
      header: 'Reimbursements',
      cell: ({ row }) => (
        <div>
          <p className="tabular-nums font-medium text-fg">{formatCurrency(row.original.reimbursementAmount)}</p>
          <p className="text-[10px] text-fg-subtle">{row.original.reimbursementCount} claim{row.original.reimbursementCount === 1 ? '' : 's'}</p>
        </div>
      ),
    },
  ], []);

  const exportRows = useMemo(() => tableRows.map((r) => ({
    employee: r.name,
    code: r.code,
    department: r.department,
    present: r.present,
    wfh: r.wfh,
    late: r.late,
    halfDay: r.halfDay,
    absent: r.absent,
    onLeave: r.onLeave,
    totalHours: r.totalHours,
    overtimeHours: r.overtimeHours,
    leaveRequests: r.leaveRequests,
    leavePending: r.leavePending,
    leaveApprovedDays: r.leaveApprovedDays,
    reimbursementCount: r.reimbursementCount,
    reimbursementAmount: r.reimbursementAmount,
  })), [tableRows]);

  return (
    <Card>
      <CardHeader
        title={`Team Performance — ${monthLabel} ${year}`}
        subtitle={isLoading ? 'Loading…' : `${tableRows.length} team member${tableRows.length === 1 ? '' : 's'}`}
        action={(
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} options={MONTH_OPTIONS} className="w-36" aria-label="Month" />
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} options={buildYearOptions()} className="w-24" aria-label="Year" />
            {isHrAdmin && (
              <Select value={department} onChange={(e) => setDepartment(e.target.value)} options={DEPARTMENTS} placeholder="All departments" className="w-44" aria-label="Department" />
            )}
            <ExportButton
              rows={exportRows}
              filename={`team-performance-${year}-${String(month).padStart(2, '0')}`}
              title={`Team Performance — ${monthLabel} ${year}`}
              columns={['employee', 'code', 'department', 'present', 'wfh', 'late', 'halfDay', 'absent', 'onLeave', 'totalHours', 'overtimeHours', 'leaveRequests', 'leavePending', 'leaveApprovedDays', 'reimbursementCount', 'reimbursementAmount']}
            />
          </div>
        )}
      />
      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : tableRows.length === 0 ? (
        <EmptyState icon={Users} title="No data for this period" message="No team members or activity found for the selected month, year, and department." />
      ) : (
        <div className={isFetching ? 'opacity-60 transition-opacity' : ''}>
          <DataTable columns={columns} data={tableRows} pageSize={10} />
        </div>
      )}
    </Card>
  );
}
