import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin, isManagerOrAbove } from '../../lib/permissions'
import { formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, PageHeader, Select, Tabs } from '../../components/ui'
import type { LeaveRecord } from '../../types'

export default function LeavesPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const initialTab = new URLSearchParams(window.location.search).get('tab')
  const [tab, setTab] = useState(initialTab || 'mine')
  const [form, setForm] = useState({
    leaveType: 'CL',
    fromDate: new Date().toISOString().split('T')[0],
    toDate: new Date().toISOString().split('T')[0],
    isHalfDay: false,
    reason: '',
  })

  const mine = useQuery({
    queryKey: ['leaves', 'mine'],
    queryFn: async () => (await api.get('/leaves/my-leaves')).data,
    enabled: tab === 'mine',
  })

  const team = useQuery({
    queryKey: ['leaves', 'team'],
    queryFn: async () => (await api.get('/leaves/team-leaves')).data,
    enabled: tab === 'team' && isManagerOrAbove(me?.role),
  })

  const all = useQuery({
    queryKey: ['leaves', 'all'],
    queryFn: async () => (await api.get('/leaves/all-leaves')).data,
    enabled: tab === 'all' && isHROrAdmin(me?.role),
  })

  const balance = useQuery({
    queryKey: ['leaves', 'balance', me?.id],
    queryFn: async () => (await api.get(`/leaves/balance/${me?.id}`)).data,
    enabled: Boolean(me?.id),
  })

  const leaveTypes = useQuery({
    queryKey: ['leaves', 'types'],
    queryFn: async () => (await api.get('/leaves/types')).data,
  })

  const leaveTypeLabel: Record<string, string> = (leaveTypes.data?.data || []).reduce((acc: any, t: any) => {
    acc[t.code] = t.name
    return acc
  }, {})

  const rows: LeaveRecord[] = tab === 'mine' ? mine.data?.data || [] : tab === 'team' ? team.data?.data || [] : all.data?.data || []
  const loading = tab === 'mine' ? mine.isLoading : tab === 'team' ? team.isLoading : all.isLoading

  const patchLeaveInCache = (updated: LeaveRecord) => {
    const keys = [
      ['leaves', 'mine'],
      ['leaves', 'team'],
      ['leaves', 'all'],
    ] as const
    for (const key of keys) {
      qc.setQueryData(key, (prev: any) => {
        const list: LeaveRecord[] = prev?.data
        if (!Array.isArray(list)) return prev
        const next = list.map((l) => (l.id === updated.id ? { ...l, ...updated } : l))
        return { ...prev, data: next }
      })
    }
  }

  const apply = useMutation({
    mutationFn: async () =>
      (await api.post('/leaves/apply', {
        leave_type: form.leaveType,
        from_date: form.fromDate,
        to_date: form.toDate,
        is_half_day: form.isHalfDay,
        reason: form.reason,
      })).data,
    onSuccess: () => {
      toast.success('Leave applied successfully')
      qc.invalidateQueries({ queryKey: ['leaves'] })
      setForm((p) => ({ ...p, reason: '' }))
    },
    onError: (e) => toast.error(getErrorMessage(e, 'Failed to apply leave')),
  })

  const approve = useMutation({
    mutationFn: async (id: string) => (await api.put(`/leaves/${id}/approve`)).data,
    onSuccess: (res) => {
      toast.success('Leave approved')
      if (res?.data) patchLeaveInCache(res.data as LeaveRecord)
      qc.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const reject = useMutation({
    mutationFn: async (id: string) => (await api.put(`/leaves/${id}/reject`, { rejection_reason: 'Rejected from dashboard' })).data,
    onSuccess: (res) => {
      toast.success('Leave rejected')
      if (res?.data) patchLeaveInCache(res.data as LeaveRecord)
      qc.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const cancel = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/leaves/${id}/cancel`)).data,
    onSuccess: () => {
      toast.success('Leave cancelled')
      qc.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const tabs = [{ id: 'mine', label: 'My Leaves' }]
  if (isManagerOrAbove(me?.role)) tabs.push({ id: 'team', label: 'Team / Approvals' })
  if (isHROrAdmin(me?.role)) tabs.push({ id: 'all', label: 'All Leaves' })

  const balanceRows = (balance.data?.data || []) as Array<{
    leaveType?: string
    leave_type?: string
    totalAllocated?: number
    total_allocated?: number
    used?: number
    encashed?: number
    available?: number
  }>

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Leaves" description="Apply, track, and approve leave requests" />

      {tab === 'mine' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 bg-muted/50 hover:shadow-md transition-shadow">
            <CardBody className="space-y-4">
              <div className="font-medium text-slate-800">Apply Leave</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Leave Type">
                  <Select value={form.leaveType} onChange={(e) => setForm((p) => ({ ...p, leaveType: e.target.value }))}>
                    {(leaveTypes.data?.data || []).map((t: any) => (
                      <option key={t.code} value={t.code}>{t.name || t.code}</option>
                    ))} 
                  </Select>
                </Field>
                <Field label="Half Day">
                  <Select value={form.isHalfDay ? 'yes' : 'no'} onChange={(e) => setForm((p) => ({ ...p, isHalfDay: e.target.value === 'yes' }))}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </Select>
                </Field>
                <Field label="From Date"><Input type="date" value={form.fromDate} onChange={(e) => setForm((p) => ({ ...p, fromDate: e.target.value }))} /></Field>
                <Field label="To Date"><Input type="date" value={form.toDate} onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))} /></Field>
                <div className="sm:col-span-2">
                  <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Reason for leave" /></Field>
                </div>
              </div>
              <Button onClick={() => apply.mutate()} disabled={apply.isPending || !form.reason.trim()}>
                {apply.isPending ? 'Applying…' : 'Apply Leave'}
              </Button>
            </CardBody>
          </Card>

          <Card className="bg-muted/50 hover:shadow-md transition-shadow">
            <CardBody>
              <div className="font-medium text-slate-800 mb-3">Leave Balance</div>
              {balance.isLoading ? <LoadingState /> : (
                <div className="space-y-2 text-sm">
                  {balanceRows.length ? balanceRows.map((b) => {
                    const type = (b.leaveType || b.leave_type || '—') as string
                    const allocated = Number(b.totalAllocated ?? b.total_allocated ?? 0)
                    const used = Number(b.used ?? 0)
                    const available = Number(b.available ?? (allocated - used - Number(b.encashed ?? 0)))
                    return (
                      <div key={type} className="rounded-lg bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700 font-medium">{leaveTypeLabel[type] || type}</span>
                          <span className="text-slate-900 font-semibold">{available}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                          <span>Allocated: {allocated}</span>
                          <span>Used: {used}</span>
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="text-sm text-slate-500">No leave balance found</div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          {loading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle="No leave records found"
              columns={[
                ...(tab !== 'mine' ? [{ key: 'employee', header: 'Employee', render: (r: LeaveRecord) => r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—' }] : []),
                { key: 'type', header: 'Type', render: (r) => leaveTypeLabel[r.leaveType] || r.leaveType },
                { key: 'from', header: 'From', render: (r) => formatDate(r.fromDate) },
                { key: 'to', header: 'To', render: (r) => formatDate(r.toDate) },
                { key: 'days', header: 'Days', render: (r) => r.totalDays ?? '—' },
                { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{formatStatus(r.status)}</Badge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r) => (
                    <div className="flex flex-wrap gap-2">
                      {tab === 'mine' && r.status === 'pending' ? (
                        <Button size="sm" variant="secondary" onClick={() => cancel.mutate(r.id)}>Cancel</Button>
                      ) : null}
                      {tab !== 'mine' && r.status === 'pending' ? (
                        <>
                          <Button size="sm" onClick={() => approve.mutate(r.id)}>Approve</Button>
                          <Button size="sm" variant="danger" onClick={() => reject.mutate(r.id)}>Reject</Button>
                        </>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
