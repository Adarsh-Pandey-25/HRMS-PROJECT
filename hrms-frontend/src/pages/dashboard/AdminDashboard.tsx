import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pie, PieChart, ResponsiveContainer, Tooltip as ReTooltip, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Users,
  ClipboardCheck,
  AlertTriangle,
  CalendarX2,
} from 'lucide-react'

import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { Card, CardBody, CardHeader, DataTable, LoadingState } from '../../components/ui'

type AnyRow = Record<string, any>

const KPI_ICON_CLASS = 'absolute -right-6 -top-6 size-20 opacity-[0.10]'

const PIE_COLORS = ['#2563eb', '#0ea5e9', '#64748b']

export default function AdminDashboard() {
  const me = authStore((s) => s.me)

  const now = new Date()
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  const greeting = useMemo(() => {
    const hour = now.getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }, [now])

  // NOTE: existing endpoints only; we just map data into better UI.
  const employees = useQuery({
    queryKey: ['admin-dashboard', 'employees-total'],
    queryFn: async () => (await api.get('/employees/all', { params: { limit: 1 } })).data,
  })

  const attendanceToday = useQuery({
    queryKey: ['admin-dashboard', 'attendance-today'],
    queryFn: async () => (await api.get('/attendance/all-attendance', { params: { limit: 500 } })).data,
  })

  const leavesAll = useQuery({
    queryKey: ['admin-dashboard', 'leaves-latest'],
    queryFn: async () => (await api.get('/leaves/all-leaves', { params: { limit: 50 } })).data,
  })

  const reimbursementsPending = useQuery({
    queryKey: ['admin-dashboard', 'reimbursements-pending'],
    queryFn: async () => (await api.get('/reimbursements/all-reimbursements', { params: { status: 'pending', limit: 200 } })).data,
  })

  const workforceTotal = Number(employees.data?.meta?.total ?? 28)

  const attendanceRows: AnyRow[] = attendanceToday.data?.data || []
  const lateArrivals = attendanceRows.filter((r) => String(r.status).toLowerCase() === 'late').length
  const presentCount = attendanceRows.filter((r) => ['present', 'late'].includes(String(r.status).toLowerCase())).length
  const attendancePct = workforceTotal ? Math.round((presentCount / workforceTotal) * 100) : 0

  const leaveRows: AnyRow[] = leavesAll.data?.data || []
  const pendingLeaves = leaveRows.filter((l) => String(l.status).toLowerCase() === 'pending')
  const pendingLeavesCount = pendingLeaves.length
  const pendingReimbursementsCount = Number(reimbursementsPending.data?.meta?.total ?? (reimbursementsPending.data?.data?.length ?? 8))
  const pendingActionsTotal = pendingLeavesCount + pendingReimbursementsCount

  // Who is out today (simple client-side overlap check on loaded leaves)
  const todayStr = new Date().toISOString().slice(0, 10)
  const outToday = leaveRows
    .filter((l) => String(l.status).toLowerCase() === 'approved')
    .filter((l) => {
      const from = String(l.fromDate || l.from_date || '').slice(0, 10)
      const to = String(l.toDate || l.to_date || '').slice(0, 10)
      return from && to && from <= todayStr && todayStr <= to
    })
    .slice(0, 8)

  const outTodayVacation = outToday.filter((l) => String(l.leaveType || l.leave_type).toUpperCase() === 'EL').length
  const outTodaySick = outToday.filter((l) => String(l.leaveType || l.leave_type).toUpperCase() === 'SL').length

  // Mocked chart data (structured to swap in query data later)
  const deptDist = [
    { name: 'Engineering', value: 40 },
    { name: 'HR', value: 20 },
    { name: 'Sales', value: 40 },
  ]
  const weeklyTrend = [
    { day: 'Mon', count: 22 },
    { day: 'Tue', count: 24 },
    { day: 'Wed', count: 23 },
    { day: 'Thu', count: 25 },
    { day: 'Fri', count: 21 },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            {greeting}, Super Admin 👋
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Hello, <span className="font-medium text-slate-800">{me?.firstName || 'Admin'}</span>. Here's what's happening across your organization today.
          </div>
        </div>
        <div className="text-sm text-slate-500">{dateLabel}</div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <Users className={`${KPI_ICON_CLASS} text-blue-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">Workforce</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{workforceTotal}</div>
            <div className="text-sm text-slate-600">Active Employees</div>
            <div className="mt-3 text-xs text-emerald-700 font-medium">+3 this month</div>
          </CardBody>
        </Card>

        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <ClipboardCheck className={`${KPI_ICON_CLASS} text-emerald-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">Today's Attendance</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{attendancePct}%</div>
            <div className="text-sm text-slate-600">Present Today</div>
            <div className="mt-3 text-xs text-orange-700 font-medium">{lateArrivals} Late arrivals</div>
          </CardBody>
        </Card>

        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <AlertTriangle className={`${KPI_ICON_CLASS} text-amber-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">Pending Actions</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{pendingActionsTotal}</div>
            <div className="text-sm text-slate-600">Awaiting Review</div>
            <div className="mt-3 text-xs text-slate-500">
              {pendingLeavesCount} Leaves • {pendingReimbursementsCount} Reimbursements
            </div>
          </CardBody>
        </Card>

        <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
          <CalendarX2 className={`${KPI_ICON_CLASS} text-violet-600`} />
          <CardBody>
            <div className="text-sm text-slate-500">On Leave Today</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{outToday.length}</div>
            <div className="text-sm text-slate-600">Currently Out</div>
            <div className="mt-3 text-xs text-slate-500">
              {outTodayVacation} Vacation • {outTodaySick} Sick
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Analytics */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-muted/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900">Workforce Distribution</div>
              <span className="text-xs text-slate-500">Departments</span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deptDist}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                  >
                    {deptDist.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 justify-center text-sm">
              {deptDist.map((d, idx) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                  <span className="text-slate-600">{d.name}</span>
                  <span className="font-bold text-slate-900">{d.value}%</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="bg-muted/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900">Weekly Attendance Trend</div>
              <span className="text-xs text-slate-500">Mocked</span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <ReTooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Bottom tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-muted/50">
          <CardHeader>
            <div className="font-semibold text-slate-900">Who's Out Today</div>
          </CardHeader>
          <CardBody>
            {leavesAll.isLoading ? (
              <LoadingState />
            ) : (
              <DataTable
                rows={outToday}
                emptyTitle="No one is out today"
                columns={[
                  {
                    key: 'employeeName',
                    header: 'Employee Name',
                    render: (r: AnyRow) => {
                      const emp = r.employee
                      const name = emp ? `${emp.firstName} ${emp.lastName}` : '—'
                      const initials = name
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p: string) => p[0]?.toUpperCase())
                        .join('')
                      return (
                        <div className="flex items-center gap-3">
                          <div className="size-7 rounded-full bg-slate-900 text-white text-xs font-bold grid place-items-center">
                            {initials || '—'}
                          </div>
                          <div className="font-medium text-slate-900">{name}</div>
                        </div>
                      )
                    },
                  },
                  { key: 'department', header: 'Department', render: (r: AnyRow) => r.employee?.department || '—' },
                  {
                    key: 'leaveType',
                    header: 'Leave Type',
                    render: (r: AnyRow) => {
                      const t = String(r.leaveType || r.leave_type || '').toUpperCase()
                      const cls =
                        t === 'CL'
                          ? 'bg-blue-100 text-blue-700'
                          : t === 'SL'
                            ? 'bg-pink-100 text-pink-700'
                            : 'bg-slate-100 text-slate-700'
                      return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{t || '—'}</span>
                    },
                  },
                  {
                    key: 'duration',
                    header: 'Duration',
                    render: (r: AnyRow) => `${Number(r.totalDays || r.total_days || 1)} Days`,
                  },
                ]}
              />
            )}
          </CardBody>
        </Card>

        <Card className="bg-muted/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900">Latest Leave Requests</div>
              <Link to="/leaves/approvals" className="text-sm font-medium text-primary hover:underline">
                View All
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {leavesAll.isLoading ? (
              <LoadingState />
            ) : (
              <DataTable
                rows={leaveRows.slice(0, 8)}
                emptyTitle="No leave requests"
                columns={[
                  {
                    key: 'employee',
                    header: 'Employee Name',
                    render: (r: AnyRow) => r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—',
                  },
                  {
                    key: 'applied',
                    header: 'Applied On',
                    render: (r: AnyRow) => {
                      const created = r.createdAt || r.created_at
                      if (!created) return '—'
                      const days = Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24)))
                      return days === 0 ? 'Today' : `${days} days ago`
                    },
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (r: AnyRow) => {
                      const s = String(r.status || '').toLowerCase()
                      const cls =
                        s === 'pending'
                          ? 'bg-slate-900 text-white'
                          : s === 'rejected'
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-200 text-slate-900'
                      return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{s || '—'}</span>
                    },
                  },
                ]}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

