import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { downloadDocument } from '../../lib/download'
import { formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Button, Card, CardBody, DataTable, Field, Input, LoadingState, PageHeader, Select } from '../../components/ui'
import type { Document } from '../../types'

export default function DocumentsPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    documentType: 'id_proof',
    documentName: '',
    file: null as File | null,
  })

  const documents = useQuery({
    queryKey: ['documents', 'mine'],
    queryFn: async () => (await api.get('/documents/my-documents')).data,
  })

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('document_type', form.documentType)
      fd.append('document_name', form.documentName)
      if (form.file) fd.append('file', form.file)
      return (await api.post('/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data
    },
    onSuccess: () => {
      toast.success('Document uploaded')
      qc.invalidateQueries({ queryKey: ['documents'] })
      setForm({ documentType: 'id_proof', documentName: '', file: null })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/documents/${id}`)).data,
    onSuccess: () => {
      toast.success('Document deleted')
      qc.invalidateQueries({ queryKey: ['documents'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Document[] = documents.data?.data || []

  const download = async (id: string, name?: string) => {
    try {
      await downloadDocument(id, name)
    } catch {
      toast.error('Download failed')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Documents" description="Secure document vault" />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          <div className="font-medium text-slate-800">Upload Document</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Document Type">
              <Select value={form.documentType} onChange={(e) => setForm((p) => ({ ...p, documentType: e.target.value }))}>
                {['id_proof', 'address_proof', 'education', 'experience', 'offer_letter', 'other'].map((t) => (
                  <option key={t} value={t}>{formatStatus(t)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Document Name"><Input value={form.documentName} onChange={(e) => setForm((p) => ({ ...p, documentName: e.target.value }))} /></Field>
            <div className="sm:col-span-2">
              <Field label="File"><Input type="file" onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] || null }))} /></Field>
            </div>
          </div>
          <Button onClick={() => upload.mutate()} disabled={upload.isPending || !form.documentName || !form.file}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </CardBody>
      </Card>

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody>
          {documents.isLoading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle="No documents uploaded"
              columns={[
                { key: 'name', header: 'Name', render: (r) => r.documentName },
                { key: 'type', header: 'Type', render: (r) => formatStatus(r.documentType) },
                { key: 'uploaded', header: 'Uploaded', render: (r) => formatDate(r.uploadedAt) },
                { key: 'expires', header: 'Expires', render: (r) => formatDate(r.expiresAt) },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r) => (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => download(r.id, r.documentName)}>Download</Button>
                      <Button size="sm" variant="danger" onClick={() => remove.mutate(r.id)}>Delete</Button>
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
