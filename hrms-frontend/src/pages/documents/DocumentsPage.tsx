import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin } from '../../lib/permissions'
import { downloadDocument, getDocumentPreviewUrl } from '../../lib/download'
import { formatDate, formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs } from '../../components/ui'
import type { Document } from '../../types'

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'joining_letter', label: 'Joining Letter' },
  { value: 'aadhar', label: 'Aadhar' },
  { value: 'pan', label: 'PAN' },
  { value: 'educational_certificate', label: 'Educational Certificate' },
  { value: 'experience_letter', label: 'Experience Letter' },
  { value: 'payslip', label: 'Payslip' },
  { value: 'form_16', label: 'Form 16' },
  { value: 'resignation_letter', label: 'Resignation Letter' },
  { value: 'relieving_letter', label: 'Relieving Letter' },
] as const

function verificationBadge(doc: Document) {
  if (doc.isVerified) {
    return <Badge status="approved">Verified</Badge>
  }
  return <Badge status="pending">Pending Verification</Badge>
}

function isImageFile(name?: string) {
  return /\.(png|jpe?g|gif|webp)$/i.test(name || '')
}

function isPdfFile(name?: string) {
  return /\.pdf$/i.test(name || '')
}

export default function DocumentsPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const canVerify = isHROrAdmin(me?.role)
  const [tab, setTab] = useState(canVerify ? 'all' : 'mine')
  const [preview, setPreview] = useState<{ doc: Document; url: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [form, setForm] = useState({
    documentType: 'aadhar',
    documentName: '',
    file: null as File | null,
  })
  const [fileInputKey, setFileInputKey] = useState(0)

  const mine = useQuery({
    queryKey: ['documents', 'mine'],
    queryFn: async () => (await api.get('/documents/my-documents')).data,
    enabled: tab === 'mine',
  })

  const all = useQuery({
    queryKey: ['documents', 'all'],
    queryFn: async () => (await api.get('/documents/all', { params: { limit: 100 } })).data,
    enabled: tab === 'all' && canVerify,
  })

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('document_type', form.documentType)
      fd.append('document_name', form.documentName)
      if (!form.file) throw new Error('File is required')
      fd.append('file', form.file)
      return (await api.post('/documents/upload', fd)).data
    },
    onSuccess: () => {
      toast.success('Document uploaded — pending verification')
      qc.invalidateQueries({ queryKey: ['documents'] })
      setForm({ documentType: 'aadhar', documentName: '', file: null })
      setFileInputKey((k) => k + 1)
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

  const verify = useMutation({
    mutationFn: async (id: string) => (await api.put(`/documents/${id}/verify`)).data,
    onSuccess: () => {
      toast.success('Document verified')
      qc.invalidateQueries({ queryKey: ['documents'] })
      setPreview(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Document[] = tab === 'all' ? all.data?.data || [] : mine.data?.data || []
  const loading = tab === 'all' ? all.isLoading : mine.isLoading

  const openPreview = async (doc: Document) => {
    try {
      setPreviewLoading(true)
      const url = await getDocumentPreviewUrl(doc.id)
      setPreview({ doc, url })
    } catch {
      toast.error('Failed to load document preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const download = async (id: string, name?: string) => {
    try {
      await downloadDocument(id, name)
    } catch {
      toast.error('Download failed')
    }
  }

  const tabs = canVerify
    ? [{ id: 'all', label: 'All Documents' }, { id: 'mine', label: 'My Documents' }]
    : [{ id: 'mine', label: 'My Documents' }]

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Documents"
        description={canVerify ? 'Review and verify employee documents' : 'Upload and track your documents'}
      />

      {tab === 'mine' ? (
        <Card className="bg-muted/50 hover:shadow-md transition-shadow">
          <CardBody className="space-y-4">
            <div className="font-medium text-slate-800">Upload Document</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Document Type">
                <Select value={form.documentType} onChange={(e) => setForm((p) => ({ ...p, documentType: e.target.value }))}>
                  {DOCUMENT_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Document Name"><Input value={form.documentName} onChange={(e) => setForm((p) => ({ ...p, documentName: e.target.value }))} /></Field>
              <div className="sm:col-span-2">
                <Field label="File">
                  <Input
                    key={fileInputKey}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] || null }))}
                  />
                </Field>
              </div>
            </div>
            <Button onClick={() => upload.mutate()} disabled={upload.isPending || !form.documentName || !form.file}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          {tabs.length > 1 ? <Tabs tabs={tabs} active={tab} onChange={setTab} /> : null}
          {loading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle={tab === 'all' ? 'No employee documents found' : 'No documents uploaded'}
              columns={[
                ...(tab === 'all'
                  ? [{
                      key: 'employee',
                      header: 'Employee',
                      render: (r: Document) => r.employee ? `${r.employee.firstName || ''} ${r.employee.lastName || ''}`.trim() : '—',
                    }]
                  : []),
                { key: 'name', header: 'Name', render: (r: Document) => r.documentName },
                { key: 'type', header: 'Type', render: (r: Document) => formatStatus(r.documentType) },
                { key: 'status', header: 'Status', render: (r: Document) => verificationBadge(r) },
                { key: 'uploaded', header: 'Uploaded', render: (r: Document) => formatDate(r.uploadedAt) },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r: Document) => (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openPreview(r)} disabled={previewLoading}>
                        View
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => download(r.id, r.documentName)}>Download</Button>
                      {canVerify && tab === 'all' && !r.isVerified ? (
                        <Button size="sm" onClick={() => verify.mutate(r.id)} disabled={verify.isPending}>
                          Verify Document
                        </Button>
                      ) : null}
                      {(tab === 'mine' || canVerify) ? (
                        <Button size="sm" variant="danger" onClick={() => remove.mutate(r.id)}>Delete</Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Modal open={Boolean(preview)} title={preview?.doc.documentName || 'Document Preview'} onClose={() => setPreview(null)}>
        {preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>{formatStatus(preview.doc.documentType)}</span>
              <span>•</span>
              {verificationBadge(preview.doc)}
              {preview.doc.employee ? (
                <>
                  <span>•</span>
                  <span>{preview.doc.employee.firstName} {preview.doc.employee.lastName}</span>
                </>
              ) : null}
            </div>

            <div className="rounded-lg border bg-slate-50 p-2 max-h-[70vh] overflow-auto">
              {isImageFile(preview.doc.documentName) ? (
                <img src={preview.url} alt={preview.doc.documentName} className="mx-auto max-h-[60vh] rounded-md object-contain" />
              ) : isPdfFile(preview.doc.documentName) ? (
                <iframe src={preview.url} title={preview.doc.documentName} className="h-[60vh] w-full rounded-md bg-white" />
              ) : (
                <div className="py-10 text-center text-sm text-slate-600">
                  Preview not available for this file type.
                  <div className="mt-3">
                    <a href={preview.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                      Open document in new tab
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="secondary" onClick={() => download(preview.doc.id, preview.doc.documentName)}>Download</Button>
              {canVerify && !preview.doc.isVerified ? (
                <Button onClick={() => verify.mutate(preview.doc.id)} disabled={verify.isPending}>
                  Verify Document
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
