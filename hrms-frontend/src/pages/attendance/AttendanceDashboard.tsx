import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { Building2, LogIn, LogOut, Monitor, Smartphone } from 'lucide-react'

import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin, isManagerOrAbove } from '../../lib/permissions'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, CardHeader, DataTable, LoadingState, PageHeader, Tabs } from '../../components/ui'
import type { AttendanceRecord } from '../../types'

const TARGET_SECONDS = 9 * 60 * 60

function statusPill(status?: string | null) {
  const s = String(status || '').toLowerCase()
  const cls =
    s === 'present'
      ? 'bg-green-100 text-green-700'
      : s === 'late'
        ? 'bg-yellow-100 text-yellow-700'
        : s === 'absent'
          ? 'bg-red-100 text-red-700'
          : s === 'half_day'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-700'
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{s || '—'}</span>
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'dd MMM yyyy')
  } catch {
    return '—'
  }
}

function fmtClock(iso?: string | null) {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'h:mm a')
  } catch {
    return '—'
  }
}

function fmtHms(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-sm font-medium text-slate-800">{value}</div>
    </div>
  )
}

export default function AttendanceDashboard() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const [tab, setTab] = useState<'mine' | 'team' | 'all'>('mine')
  const [startMs, setStartMs] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [forceStopped, setForceStopped] = useState(false)

  const canTeam = isManagerOrAbove(me?.role)
  const canAll = isHROrAdmin(me?.role)

  useEffect(() => {
    if (tab === 'team' && !canTeam) setTab('mine')
    if (tab === 'all' && !canAll) setTab('mine')
  }, [tab, canTeam, canAll])

  const my = useQuery({
    queryKey: ['attendance', 'my'],
    queryFn: async () => (await api.get('/attendance/my-attendance')).data,
    enabled: tab === 'mine',
  })

  const team = useQuery({
    queryKey: ['attendance', 'team'],
    queryFn: async () => (await api.get('/attendance/team-attendance')).data,
    enabled: tab === 'team' && canTeam,
  })

  const all = useQuery({
    queryKey: ['attendance', 'all'],
    queryFn: async () => (await api.get('/attendance/all-attendance')).data,
    enabled: tab === 'all' && canAll,
  })

  const checkContext = useQuery({
    queryKey: ['attendance', 'check-context'],
    queryFn: async () => (await api.get('/attendance/check-context')).data,
    enabled: tab === 'mine',
  })

  const clientIp = checkContext.data?.data?.clientIp as string | undefined
  const canCheckInFromThisIp = checkContext.data?.data?.canCheckInFromThisIp !== false

  const rows: AttendanceRecord[] =
    tab === 'mine' ? my.data?.data || [] : tab === 'team' ? team.data?.data || [] : all.data?.data || []
  const loading = tab === 'mine' ? my.isLoading : tab === 'team' ? team.isLoading : all.isLoading

  const todayRecord = useMemo(() => {
    const list: AttendanceRecord[] = my.data?.data || []
    // If there's any open session, it is the source of truth (backend blocks check-in until checkout).
    const open = list.find((r) => r && r.checkInTime && !r.checkOutTime)
    if (open) return open
    const today = new Date()
    return (
      list.find((r) => {
        if (!r.checkInTime) return false
        const d = new Date(r.checkInTime)
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
      }) || null
    )
  }, [my.data])

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const active = todayRecord && !todayRecord.checkOutTime
    if (active && todayRecord.checkInTime) {
      setStartMs(new Date(todayRecord.checkInTime).getTime())
      setForceStopped(false)
    } else {
      setStartMs(null)
      if (todayRecord?.checkOutTime) setForceStopped(true)
    }
  }, [todayRecord])

  const elapsed = startMs && !forceStopped ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0
  const progress = startMs && !forceStopped ? Math.min(1, elapsed / TARGET_SECONDS) : 0
  const isCheckedIn = Boolean(todayRecord && !todayRecord.checkOutTime)
  const dayComplete = Boolean(todayRecord?.checkOutTime)

  const checkIn = useMutation({
    mutationFn: async () => (await api.post('/attendance/check-in', { method: 'web' })).data,
    onSuccess: () => {
      toast.success('Checked in successfully')
      setForceStopped(false)
      qc.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: (e) => toast.error(getErrorMessage(e, 'Check-in failed')),
  })

  const checkOut = useMutation({
    mutationFn: async () => (await api.post('/attendance/check-out', { method: 'web', break_minutes: 0 })).data,
    onSuccess: () => {
      toast.success('Checked out successfully')
      // Stop timer immediately, even if "My Attendance" query is not refetched yet.
      setForceStopped(true)
      setStartMs(null)
      qc.invalidateQueries({ queryKey: ['attendance'] })
    },
    onError: (e) => toast.error(getErrorMessage(e, 'Check-out failed')),
  })

  const tabs = [{ id: 'mine', label: 'My Attendance' }]
  if (canTeam) tabs.push({ id: 'team', label: 'Team Attendance' })
  if (canAll) tabs.push({ id: 'all', label: 'All Attendance' })

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Attendance" description="Daily goal: 9 hours" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden hover:shadow-md transition-shadow">
          <CardBody>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-700">Today</div>
              <Badge status={dayComplete ? 'approved' : isCheckedIn ? 'present' : 'pending'}>
                {dayComplete ? 'Day complete' : isCheckedIn ? 'Active' : 'Not checked in'}
              </Badge>
            </div>

            <div className="mt-6 flex items-center justify-center">
              <div className="relative size-56">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `conic-gradient(hsl(var(--primary)) ${progress * 360}deg, #e5e7eb 0deg)`,
                  }}
                />
                <div className="absolute inset-2 rounded-full bg-white border flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl font-bold font-mono tabular-nums">{fmtHms(elapsed)}</div>
                    <div className="text-xs text-slate-500">/ 09:00:00</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              {dayComplete ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-center text-sm text-emerald-800">
                  Attendance completed for today.
                </div>
              ) : !isCheckedIn ? (
                <button
                  onClick={() => checkIn.mutate()}
                  disabled={checkIn.isPending || !canCheckInFromThisIp}
                  className="w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  <LogIn className="size-4" />
                  {checkIn.isPending ? 'Checking in…' : 'Check In'}
                </button>
              ) : (
                <Button className="w-full" size="lg" variant="destructive" onClick={() => checkOut.mutate()} disabled={checkOut.isPending}>
                  <LogOut className="size-4 mr-2" />
                  {checkOut.isPending ? 'Checking out…' : 'Check Out'}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="bg-muted/50 hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="font-semibold text-slate-900">Quick Summary</div>
          </CardHeader>
          <CardBody className="rounded-xl bg-white border">
            <div className="divide-y">
              <SummaryRow
                label="Your IP"
                value={clientIp ? (
                  <span className="font-mono text-xs text-slate-700">{clientIp}</span>
                ) : '—'}
              />
              <SummaryRow label="Today's check-in" value={fmtClock(todayRecord?.checkInTime)} />
              <SummaryRow
                label="Check-in IP"
                value={todayRecord?.checkInIp ? (
                  <span className="font-mono text-xs text-slate-700">{todayRecord.checkInIp}</span>
                ) : '—'}
              />
              <SummaryRow label="Today's check-out" value={fmtClock(todayRecord?.checkOutTime)} />
              <SummaryRow label="Status" value={statusPill(todayRecord?.status)} />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="bg-muted/50">
        <CardBody className="space-y-4">
          {tabs.length > 1 ? <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as any)} /> : null}

          {loading ? (
            <LoadingState />
          ) : (
            <DataTable
              rows={rows}
              emptyTitle="No attendance records found"
              columns={[
                ...(tab !== 'mine'
                  ? [
                      {
                        key: 'employee',
                        header: 'Employee',
                        render: (r: AttendanceRecord) => (r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—'),
                      },
                    ]
                  : []),
                { key: 'date', header: 'Date', render: (r: AttendanceRecord) => fmtDate(r.checkInTime) },
                ...(tab !== 'mine'
                  ? [
                      {
                        key: 'checkInIp',
                        header: 'Check-in IP',
                        render: (r: AttendanceRecord) =>
                          r.checkInIp ? <span className="font-mono text-xs text-slate-700">{r.checkInIp}</span> : '—',
                      },
                      {
                        key: 'checkOutIp',
                        header: 'Check-out IP',
                        render: (r: AttendanceRecord) =>
                          r.checkOutIp ? <span className="font-mono text-xs text-slate-700">{r.checkOutIp}</span> : '—',
                      },
                    ]
                  : []),
                {
                  key: 'duration',
                  header: 'Duration',
                  render: (r: AttendanceRecord) => {
                    const hours = Number(r.totalHours ?? 0)
                    const ok = hours >= 9
                    return <span className={`font-semibold ${ok ? 'text-emerald-700' : 'text-slate-500'}`}>{hours ? hours.toFixed(2) : '—'}h</span>
                  },
                },
                { key: 'status', header: 'Status', render: (r: AttendanceRecord) => statusPill(r.status) },
                {
                  key: 'source',
                  header: 'Source',
                  render: (r: AttendanceRecord) => {
                    const m = String((r as any)?.checkInMethod || '').toLowerCase()
                    if (m === 'office_ip') return <span className="inline-flex" title="Office Network"><Building2 className="size-4 text-slate-700" /></span>
                    if (m === 'mobile' || m === 'app') return <span className="inline-flex" title="Mobile App"><Smartphone className="size-4 text-slate-700" /></span>
                    return <span className="inline-flex" title="Web"><Monitor className="size-4 text-slate-700" /></span>
                  },
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}

