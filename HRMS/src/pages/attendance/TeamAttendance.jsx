import { useMemo, useState } from 'react';
import { UserCheck, Home, Clock, UserX, X } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, StatusBadge, DataTable, Skeleton, Input, Badge } from '../../components/ui';
import { useTeamAttendance, useTeamMembers } from '../../hooks/useAttendance';
import { useEmployees } from '../../hooks/useEmployees';
import { useAuthStore } from '../../store/authStore';
import { ExportButton } from '../../components/shared/ExportButton';
import { formatDate, cn } from '../../lib/utils';

const KPI_CARDS = [
  { key: 'present', label: 'Present', tone: 'text-success', bg: 'bg-success/10', ring: 'ring-success', icon: UserCheck },
  { key: 'wfh', label: 'WFH', tone: 'text-primary', bg: 'bg-primary/10', ring: 'ring-primary', icon: Home },
  { key: 'late', label: 'Late', tone: 'text-warning', bg: 'bg-warning/10', ring: 'ring-warning', icon: Clock },
  { key: 'absent', label: 'Absent', tone: 'text-danger', bg: 'bg-danger/10', ring: 'ring-danger', icon: UserX },
];

function formatHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n.toFixed(2)}h`;
}

function ipCell(value) {
  return value ? <span className="font-mono text-xs text-fg">{value}</span> : <span className="text-fg-subtle">—</span>;
}

export default function TeamAttendance() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState(null);
  const [search, setSearch] = useState('');

  const { data: records = [], isLoading: loadingAtt } = useTeamAttendance({ from: date, to: date });
  const { data: teamMembers = [], isLoading: loadingTeam } = useTeamMembers();
  const { employees: allEmployees = [], isLoading: loadingAll } = useEmployees();

  const roster = useMemo(() => {
    if (isHrAdmin) {
      return (allEmployees || [])
        .filter((e) => e.isActive !== false)
        .map((e) => ({
          id: e.id,
          name: e.name || `${e.firstName || ''} ${e.lastName || ''}`.trim() || 'Employee',
          department: e.department || '',
          designation: e.designation || '',
          employeeCode: e.employeeCode || '',
          attendanceMode: e.attendanceMode || 'office',
        }));
    }
    return (teamMembers || []).map((m) => ({
      id: m.id,
      name: m.name,
      department: m.department || '',
      designation: m.designation || '',
      employeeCode: m.employeeCode || '',
      attendanceMode: m.attendanceMode || 'office',
    }));
  }, [isHrAdmin, allEmployees, teamMembers]);

  // Merge attendance with full roster so absentees appear for HR/Admin and managers
  const teamAttendance = useMemo(() => {
    const byEmployee = new Map();
    for (const a of records) {
      if (!a?.employeeId) continue;
      byEmployee.set(a.employeeId, {
        ...a,
        employeeName: a.employeeName || 'Employee',
        isWfh: Boolean(a.isWfh || a.status === 'wfh'),
      });
    }

    for (const m of roster) {
      if (byEmployee.has(m.id)) continue;
      byEmployee.set(m.id, {
        id: `absent-${m.id}`,
        employeeId: m.id,
        employeeName: m.name,
        department: m.department,
        designation: m.designation,
        employeeCode: m.employeeCode,
        attendanceMode: m.attendanceMode,
        date,
        status: 'absent',
        isWfh: false,
        checkIn: null,
        checkOut: null,
        checkInIp: null,
        checkOutIp: null,
        workHours: 0,
        overtime: 0,
      });
    }

    return Array.from(byEmployee.values()).sort((a, b) =>
      String(a.employeeName || '').localeCompare(String(b.employeeName || ''))
    );
  }, [records, roster, date]);

  const attendanceKpis = useMemo(() => {
    const kpis = { present: 0, wfh: 0, late: 0, absent: 0 };
    for (const a of teamAttendance) {
      if (a.status === 'present' || a.status === 'early_departure') kpis.present += 1;
      else if (kpis[a.status] !== undefined) kpis[a.status] += 1;
    }
    return kpis;
  }, [teamAttendance]);

  const filteredTeam = useMemo(() => {
    let list = teamAttendance;
    if (statusFilter === 'present') {
      list = list.filter((a) => a.status === 'present' || a.status === 'early_departure');
    } else if (statusFilter) {
      list = list.filter((a) => a.status === statusFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        String(a.employeeName || '').toLowerCase().includes(q)
        || String(a.department || '').toLowerCase().includes(q)
        || String(a.employeeCode || '').toLowerCase().includes(q)
        || String(a.checkInIp || '').includes(q)
        || String(a.checkOutIp || '').includes(q)
      );
    }
    return list;
  }, [statusFilter, teamAttendance, search]);

  const teamColumns = useMemo(
    () => [
      {
        accessorKey: 'employeeName',
        header: 'Employee',
        cell: ({ row }) => {
          const r = row.original;
          const name = r.employeeName || 'Employee';
          return (
            <div className="flex items-center gap-3 min-w-[160px]">
              <Avatar name={name} size="sm" />
              <div>
                <p className="font-medium text-fg">{name}</p>
                <p className="text-xs text-fg-subtle">
                  {[r.employeeCode, r.department || r.designation].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'checkIn',
        header: 'Check-in',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div>
              <p className="text-sm text-fg tabular-nums">{r.checkIn || '—'}</p>
              {r.checkInMethod && <p className="text-[10px] text-fg-subtle capitalize">{r.checkInMethod}</p>}
            </div>
          );
        },
      },
      {
        accessorKey: 'checkInIp',
        header: 'Check-in IP',
        cell: ({ getValue }) => ipCell(getValue()),
      },
      {
        accessorKey: 'checkOut',
        header: 'Check-out',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div>
              <p className="text-sm text-fg tabular-nums">{r.checkOut || '—'}</p>
              {r.isAutoCheckout && <p className="text-[10px] text-fg-subtle">Auto</p>}
            </div>
          );
        },
      },
      {
        accessorKey: 'checkOutIp',
        header: 'Check-out IP',
        cell: ({ getValue }) => ipCell(getValue()),
      },
      {
        accessorKey: 'workHours',
        header: 'Total hours',
        cell: ({ getValue }) => <span className="tabular-nums font-medium">{formatHours(getValue())}</span>,
      },
      {
        accessorKey: 'isWfh',
        header: 'WFH',
        cell: ({ row }) => {
          const yes = Boolean(row.original.isWfh || row.original.status === 'wfh');
          return yes
            ? <Badge tone="primary">Yes</Badge>
            : <Badge tone="neutral">No</Badge>;
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      },
    ],
    []
  );

  const isLoading = loadingAtt
    || (role === 'manager' && loadingTeam)
    || (isHrAdmin && loadingAll);

  const exportRows = useMemo(
    () => filteredTeam.map((r) => ({
      employee: r.employeeName,
      code: r.employeeCode || '',
      department: r.department || '',
      date: r.date || date,
      checkIn: r.checkIn || '',
      checkInIp: r.checkInIp || '',
      checkOut: r.checkOut || '',
      checkOutIp: r.checkOutIp || '',
      totalHours: r.workHours ? Number(r.workHours).toFixed(2) : '',
      wfh: (r.isWfh || r.status === 'wfh') ? 'Yes' : 'No',
      status: r.status,
      method: r.checkInMethod || '',
    })),
    [filteredTeam, date]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Team Attendance"
        subtitle={isHrAdmin
          ? 'Every employee — check-in/out time, IP, hours, and WFH'
          : 'Presence across your direct reports'}
        actions={(
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
            aria-label="Attendance date"
          />
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map(({ key, label, tone, bg, ring, icon: Icon }) => {
          const active = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(active ? null : key)}
              className={cn(
                'rounded-card bg-card shadow-card border border-border/60 p-4 flex items-center gap-3 text-left w-full transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                active && `ring-2 ${ring}`
              )}
            >
              <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', bg)}>
                <Icon className={cn('h-5 w-5', tone)} />
              </div>
              <div>
                <p className={cn('text-xl font-semibold', tone)}>{attendanceKpis[key]}</p>
                <p className="text-xs text-fg-subtle">{label}</p>
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title={`Attendance — ${formatDate(date)}`}
          subtitle={
            statusFilter
              ? `Showing ${KPI_CARDS.find((k) => k.key === statusFilter).label.toLowerCase()} (${filteredTeam.length})`
              : `${filteredTeam.length} employees`
          }
          action={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Input
                placeholder="Search name, dept, IP…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48"
              />
              {statusFilter && (
                <Button variant="ghost" size="sm" icon={X} onClick={() => setStatusFilter(null)}>
                  Clear filter
                </Button>
              )}
              <ExportButton
                rows={exportRows}
                filename={`attendance-${date}`}
                title={`Team Attendance — ${formatDate(date)}`}
                columns={['employee', 'code', 'department', 'date', 'checkIn', 'checkInIp', 'checkOut', 'checkOutIp', 'totalHours', 'wfh', 'status', 'method']}
              />
            </div>
          }
        />
        {isLoading ? (
          <Skeleton className="h-48 m-5 rounded-xl" />
        ) : (
          <div className="overflow-x-auto">
            <DataTable columns={teamColumns} data={filteredTeam} pageSize={12} />
          </div>
        )}
      </Card>
    </div>
  );
}
