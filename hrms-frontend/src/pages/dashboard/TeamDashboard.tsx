import { useQuery } from '@tanstack/react-query'
import { authStore } from '../../store/auth'
import api from '../../lib/api'
import { isHROrAdmin, isManagerOrAbove } from '../../lib/permissions'
import { formatDate, formatStatus, formatTime } from '../../lib/format'
import { Badge, Card, CardBody, CardHeader, DataTable, EmptyState, LoadingState } from '../../components/ui'
import type { Announcement, AttendanceRecord, Holiday, LeaveRecord } from '../../types'
import { ClipboardCheck, CalendarDays, Users, AlertTriangle } from 'lucide-react'

const LIMIT = 8
const KPI_ICON_CLASS = 'absolute -right-6 -top-6 size-20 opacity-[0.10]'

export default function TeamDashboard() {
  const me = authStore((s) => s.me)
  const role = me?.role
  const isManager = isManagerOrAbove(role)
  const isHrAdmin = isHROrAdmin(role)

  const attendanceScope = isHrAdmin ? 'all' : isManager ? 'team' : 'my'
  const leavesScope = isHrAdmin ? 'all' : isManager ? 'team' : 'my'

  const attendance = useQuery({
    queryKey: ['dashboard', 'attendance', attendanceScope],
    queryFn: async () => {
      const path =
        attendanceScope === 'all'
          ? '/attendance/all-attendance'
          : attendanceScope === 'team'
            ? '/attendance/team-attendance'
            : '/attendance/my-attendance'
      return (await api.get(path, { params: { limit: LIMIT } })).data
    },
    enabled: Boolean(me),
  })

  const leaves = useQuery({
    queryKey: ['dashboard', 'leaves', leavesScope],
    queryFn: async () => {
      const path =
        leavesScope === 'all'
          ? '/leaves/all-leaves'
          : leavesScope === 'team'
            ? '/leaves/team-leaves'
            : '/leaves/my-leaves'
      return (await api.get(path, { params: { limit: LIMIT } })).data
    },
    enabled: Boolean(me),
  })

  const myAttendance = useQuery({
    queryKey: ['dashboard', 'attendance', 'my'],
    queryFn: async () => (await api.get('/attendance/my-attendance', { params: { limit: 1 } })).data,
    enabled: Boolean(me) && isManager,
  })

  const pendingLeaves = useQuery({
    queryKey: ['dashboard', 'leaves', 'pending'],
    queryFn: async () => {
      const path = isHrAdmin ? '/leaves/all-leaves' : '/leaves/team-leaves'
      return (await api.get(path, { params: { status: 'pending', limit: 50 } })).data
    },
    enabled: isManager,
  })

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () => (await api.get('/employees/all', { params: { limit: 1 } })).data,
    enabled: isHrAdmin,
  })

  const announcements = useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: async () => (await api.get('/announcements/active')).data,
    enabled: Boolean(me),
  })

  const holidays = useQuery({
    queryKey: ['holidays', 'upcoming'],
    queryFn: async () => (await api.get('/holidays/upcoming')).data,
    enabled: Boolean(me),
  })

  const attendanceRows: AttendanceRecord[] = attendance.data?.data || []
  const leaveRows: LeaveRecord[] = leaves.data?.data || []
  const pendingApprovals: LeaveRecord[] = pendingLeaves.data?.data || []
  const activeAnnouncements: Announcement[] = announcements.data?.data || []
  const upcomingHolidays: Holiday[] = holidays.data?.data || []

  const myRows: AttendanceRecord[] = myAttendance.data?.data || []
  const todayRecord = myRows[0] || (attendanceScope === 'my' ? attendanceRows[0] : null)
  const checkedIn = Boolean(todayRecord?.checkInTime && !todayRecord?.checkOutTime)

  const attendanceTitle = isHrAdmin ? 'Recent Attendance (All)' : isManager ? 'Recent Team Attendance' : 'Recent Attendance'
  const leavesTitle = isHrAdmin ? 'Recent Leaves (All)' : isManager ? 'Recent Team Leaves' : 'Recent Leaves'
  const showEmployeeCol = isManager

  const now = new Date()
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const greeting = (() => {
    const hour = now.getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            {greeting}, {me?.firstName || 'there'} 👋
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Here&apos;s what&apos;s happening in your workspace today.
          </div>
        </div>
        <div className="text-sm text-slate-500">{dateLabel}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <ClipboardCheck className={`${KPI_ICON_CLASS} text-emerald-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">Today&apos;s Attendance</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{checkedIn ? 'Active' : 'Not yet'}</div>
            <div className="text-sm text-slate-600">Your status</div>
            <div className="mt-3 text-xs text-slate-500">
              {todayRecord?.status ? formatStatus(todayRecord.status) : '—'}
            </div>
          </CardBody>
        </Card>

        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <CalendarDays className={`${KPI_ICON_CLASS} text-blue-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">{isManager ? 'Team Leaves' : 'My Leaves'}</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{leaveRows.length}</div>
            <div className="text-sm text-slate-600">Requests</div>
            <div className="mt-3 text-xs text-slate-500">
              {leaveRows.filter((l) => l.status === 'pending').length} pending
            </div>
          </CardBody>
        </Card>

        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <AlertTriangle className={`${KPI_ICON_CLASS} text-amber-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">Pending Actions</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{isManager ? pendingApprovals.length : 0}</div>
            <div className="text-sm text-slate-600">Awaiting review</div>
            <div className="mt-3 text-xs text-slate-500">
              {isManager ? 'Leaves awaiting action' : '—'}
            </div>
          </CardBody>
        </Card>

        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <Users className={`${KPI_ICON_CLASS} text-violet-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">{isHrAdmin ? 'Workforce' : 'Holidays'}</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">
              {isHrAdmin ? (employees.data?.meta?.total ?? '—') : upcomingHolidays.length}
            </div>
            <div className="text-sm text-slate-600">
              {isHrAdmin ? 'Active employees' : 'Upcoming'}
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {isHrAdmin ? 'Across the organization' : 'Next 30 days'}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-muted/50">
          <CardHeader>
            <div className="font-semibold text-slate-900">{attendanceTitle}</div>
          </CardHeader>
          <CardBody>
            {attendance.isLoading ? <LoadingState /> : (
              <DataTable
                rows={attendanceRows.slice(0, LIMIT)}
                emptyTitle="No attendance records yet"
                columns={[
                  ...(showEmployeeCol
                    ? [{
                        key: 'employee',
                        header: 'Employee',
                        render: (r: AttendanceRecord) =>
                          r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—',
                      }]
                    : []),
                  { key: 'date', header: 'Date', render: (r) => formatDate(r.checkInTime) },
                  { key: 'checkIn', header: 'Check In', render: (r) => formatTime(r.checkInTime) },
                  { key: 'checkOut', header: 'Check Out', render: (r) => formatTime(r.checkOutTime) },
                  { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{formatStatus(r.status)}</Badge> },
                ]}
              />
            )}
          </CardBody>
        </Card>

        <Card className="bg-muted/50">
          <CardHeader>
            <div className="font-semibold text-slate-900">{leavesTitle}</div>
          </CardHeader>
          <CardBody>
            {leaves.isLoading ? <LoadingState /> : (
              <DataTable
                rows={leaveRows.slice(0, LIMIT)}
                emptyTitle="No leave requests yet"
                columns={[
                  ...(showEmployeeCol
                    ? [{
                        key: 'employee',
                        header: 'Employee',
                        render: (r: LeaveRecord) =>
                          r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—',
                      }]
                    : []),
                  { key: 'type', header: 'Type', render: (r) => r.leaveType },
                  { key: 'from', header: 'From', render: (r) => formatDate(r.fromDate) },
                  { key: 'to', header: 'To', render: (r) => formatDate(r.toDate) },
                  { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{formatStatus(r.status)}</Badge> },
                ]}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-muted/50">
          <CardHeader>
            <div className="font-semibold text-slate-900">Announcements</div>
          </CardHeader>
          <CardBody className="space-y-3">
            {announcements.isLoading ? <LoadingState /> : activeAnnouncements.length ? (
              activeAnnouncements.slice(0, 4).map((a) => (
                <div key={a.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-800">{a.title}</div>
                    <Badge status={a.priority}>{a.priority}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 line-clamp-2">{a.content}</p>
                </div>
              ))
            ) : (
              <EmptyState title="No active announcements" />
            )}
          </CardBody>
        </Card>

        <Card className="bg-muted/50">
          <CardHeader>
            <div className="font-semibold text-slate-900">Upcoming Holidays</div>
          </CardHeader>
          <CardBody>
            {holidays.isLoading ? <LoadingState /> : (
              <DataTable
                rows={upcomingHolidays.slice(0, 5)}
                emptyTitle="No upcoming holidays"
                columns={[
                  { key: 'name', header: 'Holiday', render: (r) => r.title || r.name || '—' },
                  { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
                  { key: 'type', header: 'Type', render: (r) => formatStatus(r.type) },
                ]}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

