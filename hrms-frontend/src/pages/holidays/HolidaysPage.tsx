import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isAdmin } from '../../lib/permissions'
import { formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui'
import type { Holiday } from '../../types'

export default function HolidaysPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const year = new Date().getFullYear()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', date: '', type: 'public', description: '' })

  const holidays = useQuery({
    queryKey: ['holidays', year],
    queryFn: async () => (await api.get(`/holidays/year/${year}`)).data,
  })

  const create = useMutation({
    mutationFn: async () => (await api.post('/holidays/create', {
      title: form.name,
      date: form.date,
      type: form.type,
      description: form.description,
    })).data,
    onSuccess: () => {
      toast.success('Holiday created')
      qc.invalidateQueries({ queryKey: ['holidays'] })
      setOpen(false)
      setForm({ name: '', date: '', type: 'public', description: '' })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/holidays/${id}`)).data,
    onSuccess: () => {
      toast.success('Holiday deleted')
      qc.invalidateQueries({ queryKey: ['holidays'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Holiday[] = holidays.data?.data || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Holidays"
        description={`Company holiday calendar ${year}`}
        action={isAdmin(me?.role) ? <Button onClick={() => setOpen(true)}>Add Holiday</Button> : undefined}
      />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody>
          {holidays.isLoading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle="No holidays configured"
              columns={[
                { key: 'name', header: 'Holiday', render: (r) => r.title || r.name || '—' },
                { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
                { key: 'type', header: 'Type', render: (r) => <Badge status={r.type}>{formatStatus(r.type)}</Badge> },
                { key: 'description', header: 'Description', render: (r) => r.description || '—' },
                ...(isAdmin(me?.role) ? [{
                  key: 'actions',
                  header: 'Actions',
                  render: (r: Holiday) => <Button size="sm" variant="danger" onClick={() => remove.mutate(r.id)}>Delete</Button>,
                }] : []),
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Modal open={open} title="Add Holiday" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
          <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
              <option value="public">Public</option>
              <option value="optional">Optional</option>
              <option value="restricted">Restricted</option>
            </Select>
          </Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save Holiday'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
