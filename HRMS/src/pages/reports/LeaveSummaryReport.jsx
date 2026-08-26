import { useMemo, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { Card, CardHeader, Select, Avatar, DataTable, SkeletonTable, EmptyState, SegmentedControl } from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { useLeaveSummaryReport } from '../../hooks/useReports';
import { useAuthStore } from '../../store/authStore';
import { DEPARTMENTS } from '../../lib/constants';
import { buildYearOptions, employeeName } from './reportUtils';

const GROUP_OPTIONS = [
  { value: 'employee', label: 'By Employee' },
  { value: 'department', label: 'By Department' },
];

/** Flatten {employee, balances:[...]} rows into one row per employee × leave type. */
function flattenEmployeeRows(rows) {
  const out = [];
  for (const r of rows) {
    const name = employeeName(r.employee);
    const code = r.employee?.employeeCode || '';
    const department = r.employee?.department || '—';
    for (const b of r.balances || []) {
      out.push({
        id: `${r.employee?.id}-${b.leaveType}`,
        name,
        code,
        department,
        leaveType: b.name || b.leaveType,
        totalAllocated: Number(b.totalAllocated || 0),
        used: Number(b.used || 0),
        remaining: Number(b.available ?? (Number(b.totalAllocated || 0) - Number(b.used || 0) - Number(b.encashed || 0))),
      });
    }
  }
  return out;
}

/** Flatten {department, employeeCount, byType:[...]} rows into one row per department × leave type. */
function flattenDepartmentRows(rows) {
  const out = [];
  for (const r of rows) {
    for (const t of r.byType || []) {
      out.push({
        id: `${r.department}-${t.leaveType}`,
        department: r.department || 'Unassigned',
        employeeCount: r.employeeCount ?? 0,
        leaveType: t.name || t.leaveType,
        totalAllocated: Number(t.totalAllocated || 0),
        used: Number(t.used || 0),
        remaining: Number(t.available || 0),
      });
    }
  }
  return out;
}

export default function LeaveSummaryReport() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const [year, setYear] = useState(new Date().getFullYear());
  const [department, setDepartment] = useState('');
  const [groupBy, setGroupBy] = useState('employee');

  const { data: rows = [], isLoading, isFetching } = useLeaveSummaryReport({ year, department, groupBy });

  const tableRows = useMemo(
    () => (groupBy === 'department' ? flattenDepartmentRows(rows) : flattenEmployeeRows(rows)),
    [rows, groupBy]
  );

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
    { accessorKey: 'leaveType', header: 'Leave Type' },
    { accessorKey: 'totalAllocated', header: 'Allocated', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'used', header: 'Used', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'remaining', header: 'Remaining', cell: ({ getValue }) => <span className={`tabular-nums font-semibold ${getValue() < 0 ? 'text-danger' : ''}`}>{getValue()}</span> },
  ], []);

  const departmentColumns = useMemo(() => [
    { accessorKey: 'department', header: 'Department', cell: ({ getValue }) => <span className="font-medium text-fg">{getValue()}</span> },
    { accessorKey: 'employeeCount', header: 'Employees', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'leaveType', header: 'Leave Type' },
    { accessorKey: 'totalAllocated', header: 'Allocated', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'used', header: 'Used', cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { accessorKey: 'remaining', header: 'Remaining', cell: ({ getValue }) => <span className={`tabular-nums font-semibold ${getValue() < 0 ? 'text-danger' : ''}`}>{getValue()}</span> },
  ], []);

  const exportRows = useMemo(() => (groupBy === 'department'
    ? tableRows.map((r) => ({
      department: r.department,
      employees: r.employeeCount,
      leaveType: r.leaveType,
      allocated: r.totalAllocated,
      used: r.used,
      remaining: r.remaining,
    }))
    : tableRows.map((r) => ({
      employee: r.name,
      code: r.code,
      department: r.department,
      leaveType: r.leaveType,
      allocated: r.totalAllocated,
      used: r.used,
      remaining: r.remaining,
    }))), [tableRows, groupBy]);

  return (
    <Card>
      <CardHeader
        title={`Leave Summary — ${year}`}
        subtitle={isLoading ? 'Loading…' : `${tableRows.length} row${tableRows.length === 1 ? '' : 's'}`}
        action={(
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <SegmentedControl options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} />
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} options={buildYearOptions()} className="w-24" aria-label="Year" />
            {isHrAdmin && (
              <Select value={department} onChange={(e) => setDepartment(e.target.value)} options={DEPARTMENTS} placeholder="All departments" className="w-44" aria-label="Department" />
            )}
            <ExportButton
              rows={exportRows}
              filename={`leave-summary-${year}`}
              title={`Leave Summary — ${year}`}
              columns={groupBy === 'department'
                ? ['department', 'employees', 'leaveType', 'allocated', 'used', 'remaining']
                : ['employee', 'code', 'department', 'leaveType', 'allocated', 'used', 'remaining']}
            />
          </div>
        )}
      />
      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : tableRows.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No leave balance data" message="No employees or leave balances found for the selected year and department." />
      ) : (
        <div className={isFetching ? 'opacity-60 transition-opacity' : ''}>
          <DataTable columns={groupBy === 'department' ? departmentColumns : employeeColumns} data={tableRows} pageSize={12} />
        </div>
      )}
    </Card>
  );
}
