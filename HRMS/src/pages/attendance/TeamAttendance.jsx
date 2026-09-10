import { useMemo, useState } from 'react';
import { UserCheck, Home, Clock, UserX, X, Loader2 } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Avatar, StatusBadge, DataTable, Skeleton, Input, Badge, StatCard } from '../../components/ui';
import { useTeamAttendance, useTeamMembers } from '../../hooks/useAttendance';
import { useEmployees } from '../../hooks/useEmployees';
import { useAuthStore } from '../../store/authStore';
import { ExportButton } from '../../components/shared/ExportButton';
import { formatDate, cn } from '../../lib/utils';

const KPI_CARDS = [
  { key: 'present', label: 'Present', tone: 'success', icon: UserCheck },
  { key: 'inProgress', label: 'Awaiting Checkout', tone: 'info', icon: Loader2 },
  { key: 'wfh', label: 'WFH', tone: 'primary', icon: Home },
  { key: 'late', label: 'Late', tone: 'warning', icon: Clock },
  { key: 'absent', label: 'Absent', tone: 'danger', icon: UserX },
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

  // Present/WFH/Late/Absent are the only 4 summary tiles this view has — a
  // row whose status is 'half_day' or 'early_departure' still means the
  // employee showed up and worked real hours (just not a full day), so both
  // fold into the Present bucket. Previously 'half_day' matched neither
  // branch here at all and was silently dropped from every KPI count,
  // undercounting Present without ever showing up as Absent either — the
  // per-row StatusBadge was always correct, only this aggregation wasn't.
  const attendanceKpis = useMemo(() => {
    const kpis = { present: 0, wfh: 0, late: 0, absent: 0, inProgress: 0 };
    for (const a of teamAttendance) {
      // Biometric 'pending' rows carry a 'present' placeholder status
      // server-side (see attendance.service.js) that must never be shown
      // or counted as authoritative before checkout_status finalizes —
      // they're their own bucket here, not folded into Present.
      if (a.checkoutStatus === 'pending') { kpis.inProgress += 1; continue; }
      if (a.status === 'present' || a.status === 'early_departure' || a.status === 'half_day') kpis.present += 1;
      else if (kpis[a.status] !== undefined) kpis[a.status] += 1;
    }
    return kpis;
  }, [teamAttendance]);

  const filteredTeam = useMemo(() => {
    let list = teamAttendance;
    if (statusFilter === 'inProgress') {
      list = list.filter((a) => a.checkoutStatus === 'pending');
    } else if (statusFilter === 'present') {
      list = list.filter((a) => a.checkoutStatus !== 'pending'
        && (a.status === 'present' || a.status === 'early_departure' || a.status === 'half_day'));
    } else if (statusFilter) {
      list = list.filter((a) => a.checkoutStatus !== 'pending' && a.status === statusFilter);
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
          if (r.checkoutStatus === 'pending') {
            return <span className="inline-flex items-center gap-1 text-xs text-info font-medium"><Loader2 className="h-3 w-3" />Awaiting checkout</span>;
          }
          return (
            <div>
              <p className="text-sm text-fg tabular-nums">{r.checkOut || '—'}</p>
              {r.isAutoCheckout && <p className="text-[10px] text-fg-subtle">Auto</p>}
              {r.checkoutStatus === 'provisional' && <p className="text-[10px] text-warning font-medium">may still update</p>}
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
        cell: ({ row }) => {
          const r = row.original;
          if (r.checkoutStatus === 'pending') return <Badge tone="info">Awaiting checkout</Badge>;
          return (
            <div className="flex items-center gap-1.5">
              <StatusBadge status={r.status} />
              {r.checkoutStatus === 'provisional' && <span className="text-[10px] text-warning font-medium">may update</span>}
            </div>
          );
        },
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
      status: r.checkoutStatus === 'pending' ? 'awaiting_checkout' : r.checkoutStatus === 'provisional' ? `${r.status} (provisional)` : r.status,
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {KPI_CARDS.map(({ key, label, tone, icon }) => (
          <StatCard
            key={key}
            label={label}
            value={attendanceKpis[key]}
            icon={icon}
            tone={tone}
            active={statusFilter === key}
            onClick={() => setStatusFilter(statusFilter === key ? null : key)}
          />
        ))}
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
