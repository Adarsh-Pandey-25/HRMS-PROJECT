import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Card, CardHeader, Select, Avatar, DataTable, SkeletonTable, EmptyState, DateRangePicker } from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { useAttendanceSummaryReport } from '../../hooks/useReports';
import { useAuthStore } from '../../store/authStore';
import { DEPARTMENTS } from '../../lib/constants';
import { formatDate } from '../../lib/utils';
import { currentMonthRange, employeeName } from './reportUtils';

export default function AttendanceSummaryReport() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const defaultRange = useMemo(() => currentMonthRange(), []);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [department, setDepartment] = useState('');

  const { data: rows = [], isLoading, isFetching } = useAttendanceSummaryReport({ from, to, department });

  const tableRows = useMemo(() => rows.map((r) => ({
    id: r.employee?.id,
    name: employeeName(r.employee),
    code: r.employee?.employeeCode || '',
    department: r.employee?.department || '—',
    present: r.summary?.present ?? 0,
    wfh: r.summary?.wfh ?? 0,
    late: r.summary?.late ?? 0,
    halfDay: r.summary?.halfDay ?? 0,
    absent: r.summary?.absent ?? 0,
    leaveDays: r.summary?.leaveDays ?? 0,
    totalHours: r.summary?.totalHours ?? 0,
    overtimeHours: r.summary?.overtimeHours ?? 0,
    workingDays: r.summary?.workingDays ?? 0,
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
    { accessorKey: 'halfDay', header: 'Half-day', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'absent', header: 'Absent', cell: ({ getValue }) => <span className={getValue() > 0 ? 'tabular-nums text-danger font-medium' : 'tabular-nums'}>{getValue()}</span> },
    { accessorKey: 'leaveDays', header: 'Leave Days', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'totalHours', header: 'Total Hrs', cell: ({ getValue }) => <span className="tabular-nums font-medium">{Number(getValue() || 0).toFixed(1)}</span> },
    { accessorKey: 'overtimeHours', header: 'OT Hrs', cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() || 0).toFixed(1)}</span> },
  ], []);

  const exportRows = useMemo(() => tableRows.map((r) => ({
    employee: r.name,
    code: r.code,
    department: r.department,
    workingDays: r.workingDays,
    present: r.present,
    wfh: r.wfh,
    late: r.late,
    halfDay: r.halfDay,
    absent: r.absent,
    leaveDays: r.leaveDays,
    totalHours: r.totalHours,
    overtimeHours: r.overtimeHours,
  })), [tableRows]);

  return (
    <Card>
      <CardHeader
        title={`Attendance Summary — ${formatDate(from)} to ${formatDate(to)}`}
        subtitle={isLoading ? 'Loading…' : `${tableRows.length} employee${tableRows.length === 1 ? '' : 's'}`}
        action={(
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} className="w-auto" />
            {isHrAdmin && (
              <Select value={department} onChange={(e) => setDepartment(e.target.value)} options={DEPARTMENTS} placeholder="All departments" className="w-44" aria-label="Department" />
            )}
            <ExportButton
              rows={exportRows}
              filename={`attendance-summary-${from}-to-${to}`}
              title={`Attendance Summary — ${formatDate(from)} to ${formatDate(to)}`}
              columns={['employee', 'code', 'department', 'workingDays', 'present', 'wfh', 'late', 'halfDay', 'absent', 'leaveDays', 'totalHours', 'overtimeHours']}
            />
          </div>
        )}
      />
      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : tableRows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No attendance data" message="No employees or attendance records found for the selected date range and department." />
      ) : (
        <div className={isFetching ? 'opacity-60 transition-opacity' : ''}>
          <DataTable columns={columns} data={tableRows} pageSize={10} />
        </div>
      )}
    </Card>
  );
}
