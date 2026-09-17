import { useMemo, useState, useEffect } from 'react';
import { UserCheck, Home, Clock, UserX, X, Loader2, Columns3, ChevronDown } from 'lucide-react';
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

const ALL_COLUMNS = [
 { key: 'employeeName', label: 'Employee', defaultVisible: true },
 { key: 'checkIn', label: 'Check-in', defaultVisible: true },
 { key: 'checkInIp', label: 'Check-in IP', defaultVisible: false },
 { key: 'checkOut', label: 'Check-out', defaultVisible: true },
 { key: 'checkOutIp', label: 'Check-out IP', defaultVisible: false },
 { key: 'workHours', label: 'Total hours', defaultVisible: true },
 { key: 'isWfh', label: 'WFH', defaultVisible: true },
 { key: 'status', label: 'Status', defaultVisible: true },
];

const STORAGE_KEY = 'attendance_visible_columns';

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
 const [showColumnFilter, setShowColumnFilter] = useState(false);
 const [visibleColumns, setVisibleColumns] = useState(() => {
 try {
 const saved = localStorage.getItem(STORAGE_KEY);
 if (saved) return JSON.parse(saved);
 } catch {}
 return ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
 });

 useEffect(() => {
 try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
 } catch {}
 }, [visibleColumns]);

 const toggleColumn = (key) => {
 setVisibleColumns(prev =>
 prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
 );
 };

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
 checkoutStatus: null,
 });
 }
 return Array.from(byEmployee.values()).sort((a, b) =>
 String(a.employeeName || '').localeCompare(String(b.employeeName || ''))
 );
 }, [records, roster, date]);

 const attendanceKpis = useMemo(() => {
 const kpis = { present: 0, wfh: 0, late: 0, absent: 0, inProgress: 0 };
 for (const a of teamAttendance) {
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

 const teamColumns = useMemo(() => {
 const cols = [];
 if (visibleColumns.includes('employeeName')) {
 cols.push({
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
 });
 }
 if (visibleColumns.includes('checkIn')) {
 cols.push({
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
 });
 }
 if (visibleColumns.includes('checkInIp')) {
 cols.push({
 accessorKey: 'checkInIp',
 header: 'Check-in IP',
 cell: ({ getValue }) => ipCell(getValue()),
 });
 }
 if (visibleColumns.includes('checkOut')) {
 cols.push({
 accessorKey: 'checkOut',
 header: 'Check-out',
 cell: ({ row }) => {
 const r = row.original;
 if (r.checkoutStatus === 'pending') {
 return <span className="inline-flex items-center gap-1 text-xs text-info font-medium"><Loader2 className="h-3 w-3 animate-spin" />Awaiting checkout</span>;
 }
 return (
 <div>
 <p className="text-sm text-fg tabular-nums">{r.checkOut || '—'}</p>
 {r.isAutoCheckout && <p className="text-[10px] text-fg-subtle">Auto</p>}
 {r.checkoutStatus === 'provisional' && <p className="text-[10px] text-warning font-medium">may still update</p>}
 </div>
 );
 },
 });
 }
 if (visibleColumns.includes('checkOutIp')) {
 cols.push({
 accessorKey: 'checkOutIp',
 header: 'Check-out IP',
 cell: ({ getValue }) => ipCell(getValue()),
 });
 }
 if (visibleColumns.includes('workHours')) {
 cols.push({
 accessorKey: 'workHours',
 header: 'Total hours',
 cell: ({ getValue }) => <span className="tabular-nums font-medium">{formatHours(getValue())}</span>,
 });
 }
 if (visibleColumns.includes('isWfh')) {
 cols.push({
 accessorKey: 'isWfh',
 header: 'WFH',
 cell: ({ row }) => {
 const yes = Boolean(row.original.isWfh || row.original.status === 'wfh');
 return yes ? <Badge tone="primary">Yes</Badge> : <Badge tone="neutral">No</Badge>;
 },
 });
 }
 if (visibleColumns.includes('status')) {
 cols.push({
 accessorKey: 'status',
 header: 'Status',
 cell: ({ row }) => {
 const r = row.original;
 if (r.checkoutStatus === 'pending') return <StatusBadge status="present" />;
 return (
 <div className="flex items-center gap-1.5">
 <StatusBadge status={r.status} />
 {r.checkoutStatus === 'provisional' && <span className="text-[10px] text-warning font-medium">may update</span>}
 </div>
 );
 },
 });
 }
 return cols;
 }, [visibleColumns]);

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
 status: r.checkoutStatus === 'pending' ? 'present' : r.checkoutStatus === 'provisional' ? `${r.status} (provisional)` : r.status,
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
 <div className="relative">
 <Button
 variant="ghost"
 size="sm"
 icon={Columns3}
 onClick={() => setShowColumnFilter(!showColumnFilter)}
 >
 Columns <ChevronDown className="h-3 w-3 ml-1" />
 </Button>
 {showColumnFilter && (
 <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-card border border-border rounded-lg shadow-xl p-2">
 <p className="text-xs font-medium text-fg-subtle px-2 py-1.5 border-b border-border/60 mb-1">Visible Columns</p>
 {ALL_COLUMNS.map((col) => (
 <label
 key={col.key}
 className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded cursor-pointer text-sm"
 >
 <input
 type="checkbox"
 checked={visibleColumns.includes(col.key)}
 onChange={() => toggleColumn(col.key)}
 className="rounded border-border text-primary focus:ring-primary"
 />
 <span className="text-fg">{col.label}</span>
 </label>
 ))}
 </div>
 )}
 </div>
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
