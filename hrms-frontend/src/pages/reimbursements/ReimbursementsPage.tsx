import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin, isManagerOrAbove } from '../../lib/permissions'
import { formatCurrency, formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, PageHeader, Select, Tabs, Textarea } from '../../components/ui'
import type { Reimbursement } from '../../types'

export default function ReimbursementsPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const [tab, setTab] = useState('mine')
  const [form, setForm] = useState({
    reimbursementType: 'travel',
    amount: '',
    description: '',
    expenseDate: new Date().toISOString().split('T')[0],
    receipt: null as File | null,
  })

  const mine = useQuery({
    queryKey: ['reimbursements', 'mine'],
    queryFn: async () => (await api.get('/reimbursements/my-reimbursements')).data,
    enabled: tab === 'mine',
  })

  const team = useQuery({
    queryKey: ['reimbursements', 'team'],
    queryFn: async () => (await api.get('/reimbursements/team-reimbursements')).data,
    enabled: tab === 'team' && isManagerOrAbove(me?.role),
  })

  const all = useQuery({
    queryKey: ['reimbursements', 'all'],
    queryFn: async () => (await api.get('/reimbursements/all-reimbursements')).data,
    enabled: tab === 'all' && isHROrAdmin(me?.role),
  })

  const rows: Reimbursement[] = tab === 'mine' ? mine.data?.data || [] : tab === 'team' ? team.data?.data || [] : all.data?.data || []
  const loading = tab === 'mine' ? mine.isLoading : tab === 'team' ? team.isLoading : all.isLoading

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('reimbursement_type', form.reimbursementType)
      fd.append('amount', form.amount)
      fd.append('description', form.description)
      fd.append('expense_date', form.expenseDate)
      if (form.receipt) fd.append('receipt', form.receipt)
      return (await api.post('/reimbursements/submit', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data
    },
    onSuccess: () => {
      toast.success('Reimbursement submitted')
      qc.invalidateQueries({ queryKey: ['reimbursements'] })
      setForm({ reimbursementType: 'travel', amount: '', description: '', expenseDate: new Date().toISOString().split('T')[0], receipt: null })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const approve = useMutation({
    mutationFn: async (id: string) => (await api.put(`/reimbursements/${id}/approve`)).data,
    onSuccess: () => { toast.success('Approved'); qc.invalidateQueries({ queryKey: ['reimbursements'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const reject = useMutation({
    mutationFn: async (id: string) => (await api.put(`/reimbursements/${id}/reject`, { rejection_reason: 'Rejected' })).data,
    onSuccess: () => { toast.success('Rejected'); qc.invalidateQueries({ queryKey: ['reimbursements'] }) },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const tabs = [{ id: 'mine', label: 'My Claims' }]
  if (isManagerOrAbove(me?.role)) tabs.push({ id: 'team', label: 'Team / Approvals' })
  if (isHROrAdmin(me?.role)) tabs.push({ id: 'all', label: 'All Claims' })

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reimbursements" description="Submit expense claims and manage approvals" />

      {tab === 'mine' ? (
        <Card className="bg-muted/50 hover:shadow-md transition-shadow">
          <CardBody className="space-y-4">
            <div className="font-medium text-slate-800">Submit Claim</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type">
                <Select value={form.reimbursementType} onChange={(e) => setForm((p) => ({ ...p, reimbursementType: e.target.value }))}>
                  {['travel', 'food', 'medical', 'internet', 'equipment', 'other'].map((t) => (
                    <option key={t} value={t}>{formatStatus(t)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount (₹)"><Input type="number" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} /></Field>
              <Field label="Expense Date"><Input type="date" value={form.expenseDate} onChange={(e) => setForm((p) => ({ ...p, expenseDate: e.target.value }))} /></Field>
              <Field label="Receipt">
                <Input type="file" accept="image/*,.pdf" onChange={(e) => setForm((p) => ({ ...p, receipt: e.target.files?.[0] || null }))} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
              </div>
            </div>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending || !form.amount || !form.description}>
              {submit.isPending ? 'Submitting…' : 'Submit Claim'}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          {loading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle="No reimbursement claims found"
              columns={[
                ...(tab !== 'mine' ? [{ key: 'employee', header: 'Employee', render: (r: Reimbursement) => r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '—' }] : []),
                { key: 'type', header: 'Type', render: (r) => formatStatus(r.reimbursementType) },
                { key: 'amount', header: 'Amount', render: (r) => formatCurrency(r.amount) },
                { key: 'date', header: 'Date', render: (r) => formatDate(r.expenseDate) },
                { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{formatStatus(r.status)}</Badge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r) => tab !== 'mine' && r.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approve.mutate(r.id)}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => reject.mutate(r.id)}>Reject</Button>
                    </div>
                  ) : '—',
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
