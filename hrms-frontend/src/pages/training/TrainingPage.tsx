import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin } from '../../lib/permissions'
import { formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs, Textarea } from '../../components/ui'
import type { EmployeeTraining, Training } from '../../types'

export default function TrainingPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const [tab, setTab] = useState('mine')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'technical',
    startDate: '',
    endDate: '',
  })

  const mine = useQuery({
    queryKey: ['training', 'mine'],
    queryFn: async () => (await api.get('/training/my-trainings')).data,
    enabled: tab === 'mine',
  })

  const catalog = useQuery({
    queryKey: ['training', 'all'],
    queryFn: async () => (await api.get('/training/all-trainings')).data,
    enabled: tab === 'catalog',
  })

  const create = useMutation({
    mutationFn: async () => (await api.post('/training/create', form)).data,
    onSuccess: () => {
      toast.success('Training created')
      qc.invalidateQueries({ queryKey: ['training'] })
      setOpen(false)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const complete = useMutation({
    mutationFn: async (id: string) => (await api.put(`/training/${id}/complete`)).data,
    onSuccess: () => {
      toast.success('Training marked complete')
      qc.invalidateQueries({ queryKey: ['training'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const myRows: EmployeeTraining[] = mine.data?.data || []
  const catalogRows: Training[] = catalog.data?.data || []

  const tabs = [
    { id: 'mine', label: 'My Trainings' },
    { id: 'catalog', label: 'Training Catalog' },
  ]

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Training"
        description="Learning and development programs"
        action={isHROrAdmin(me?.role) ? <Button onClick={() => setOpen(true)}>Create Training</Button> : undefined}
      />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />

          {tab === 'mine' ? (
            mine.isLoading ? <LoadingState /> : (
              <div className="grid gap-4 md:grid-cols-2">
                {myRows.length ? myRows.map((row) => (
                  <Card key={row.id}>
                    <CardBody className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{row.training?.title || 'Training'}</div>
                        <Badge status={row.status}>{formatStatus(row.status)}</Badge>
                      </div>
                      <p className="text-sm text-slate-600">{row.training?.description || '—'}</p>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${row.progress || (row.status === 'completed' ? 100 : 30)}%` }} />
                      </div>
                      {row.status !== 'completed' ? (
                        <Button size="sm" onClick={() => complete.mutate(row.id)}>Mark Complete</Button>
                      ) : null}
                    </CardBody>
                  </Card>
                )) : <div className="text-sm text-slate-500 py-8 text-center md:col-span-2">No trainings assigned yet</div>}
              </div>
            )
          ) : catalog.isLoading ? <LoadingState /> : (
            <DataTable
              rows={catalogRows}
              emptyTitle="No trainings in catalog"
              columns={[
                { key: 'title', header: 'Title', render: (r) => r.title },
                { key: 'category', header: 'Category', render: (r) => formatStatus(r.category || '') },
                { key: 'start', header: 'Start', render: (r) => formatDate(r.startDate) },
                { key: 'end', header: 'End', render: (r) => formatDate(r.endDate) },
                { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{formatStatus(r.status || 'active')}</Badge> },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Modal open={open} title="Create Training" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
              <option value="technical">Technical</option>
              <option value="soft_skills">Soft Skills</option>
              <option value="compliance">Compliance</option>
              <option value="leadership">Leadership</option>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start Date"><Input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} /></Field>
            <Field label="End Date"><Input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} /></Field>
          </div>
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Training'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
