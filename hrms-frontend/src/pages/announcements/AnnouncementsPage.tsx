import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin } from '../../lib/permissions'
import { formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, Field, Input, LoadingState, Modal, PageHeader, Select, Textarea } from '../../components/ui'
import type { Announcement } from '../../types'

export default function AnnouncementsPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    title: '',
    content: '',
    priority: 'medium',
    targetAudience: 'all',
  })

  const announcements = useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: async () => (await api.get('/announcements/active')).data,
  })

  const create = useMutation({
    mutationFn: async () => (await api.post('/announcements/create', form)).data,
    onSuccess: () => {
      toast.success('Announcement published')
      qc.invalidateQueries({ queryKey: ['announcements'] })
      setOpen(false)
      setForm({ title: '', content: '', priority: 'medium', targetAudience: 'all' })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const acknowledge = useMutation({
    mutationFn: async (id: string) => (await api.post(`/announcements/${id}/acknowledge`)).data,
    onSuccess: () => {
      toast.success('Marked as read')
      qc.invalidateQueries({ queryKey: ['announcements'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const items: Announcement[] = announcements.data?.data || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Announcements"
        description="Company news and updates"
        action={isHROrAdmin(me?.role) ? <Button onClick={() => setOpen(true)}>New Announcement</Button> : undefined}
      />

      {announcements.isLoading ? <LoadingState /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.length ? items.map((a) => (
            <Card key={a.id} className="bg-muted/50 hover:shadow-md transition-shadow">
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{a.title}</div>
                    <div className="text-xs text-slate-500">{formatDate(a.publishedAt)}</div>
                  </div>
                  <Badge status={a.priority}>{a.priority}</Badge>
                </div>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{a.content}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 capitalize">For: {formatStatus(a.targetAudience)}</span>
                  <Button size="sm" variant="secondary" onClick={() => acknowledge.mutate(a.id)}>Mark as read</Button>
                </div>
              </CardBody>
            </Card>
          )) : (
            <Card className="md:col-span-2"><CardBody><div className="text-center text-sm text-slate-500 py-8">No announcements right now</div></CardBody></Card>
          )}
        </div>
      )}

      <Modal open={open} title="New Announcement" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field>
          <Field label="Content"><Textarea value={form.content} onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))} /></Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Audience">
            <Select value={form.targetAudience} onChange={(e) => setForm((p) => ({ ...p, targetAudience: e.target.value }))}>
              <option value="all">All</option>
              <option value="employees">Employees</option>
              <option value="managers">Managers</option>
            </Select>
          </Field>
          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
