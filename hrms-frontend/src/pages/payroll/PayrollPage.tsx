import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { authStore } from '../../store/auth'
import { isHROrAdmin } from '../../lib/permissions'
import { formatCurrency, formatStatus, monthName } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import {
  downloadPayslipPdf,
  generatePayslips,
  getPayrollMonth,
  initializePayrollMonth,
  listPayslips,
  publishPayslip,
} from '../../lib/payroll.api'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs } from '../../components/ui'
import type { Payslip } from '../../types'

const inr = (n?: number) => formatCurrency(n)

function payslipStatusBadge(status?: string) {
  const s = String(status || '').toUpperCase()
  if (s === 'PUBLISHED') return <Badge status="approved">Published</Badge>
  if (s === 'DRAFT') return <Badge status="pending">Draft</Badge>
  return <Badge status={status}>{formatStatus(status)}</Badge>
}

export default function PayrollPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const canManage = isHROrAdmin(me?.role)
  const now = useMemo(() => new Date(), [])
  const [tab, setTab] = useState(canManage ? 'manage' : 'mine')
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() })
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState('Payslip')
  const [previewPayslip, setPreviewPayslip] = useState<Payslip | null>(null)

  const monthQuery = useQuery({
    queryKey: ['payroll', 'month', period.month, period.year],
    queryFn: () => getPayrollMonth(period.month, period.year),
    enabled: canManage && tab === 'manage',
  })

  const payslips = useQuery({
    queryKey: ['payroll', 'payslips', period.month, period.year, tab],
    queryFn: () => listPayslips(period.month, period.year),
  })

  const initMonth = useMutation({
    mutationFn: () => initializePayrollMonth(period.month, period.year),
    onSuccess: () => {
      toast.success('Payroll month initialized')
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const generate = useMutation({
    mutationFn: () => {
      const monthId = monthQuery.data?.id
      if (!monthId) throw new Error('Initialize payroll month first')
      return generatePayslips(monthId)
    },
    onSuccess: () => {
      toast.success('Draft payslips generated')
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const publish = useMutation({
    mutationFn: (id: string) => publishPayslip(id),
    onSuccess: () => {
      toast.success('Payslip published')
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Payslip[] = payslips.data || []
  const payrollMonth = monthQuery.data

  const openPdf = async (payslip: Payslip) => {
    try {
      const blob = await downloadPayslipPdf(payslip.id)
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      setPdfUrl(url)
      setPreviewPayslip(payslip)
      setPreviewTitle(`${payslip.employee?.firstName || payslip.firstName || 'Employee'} — ${monthName(payslip.month)} ${payslip.year}`)
    } catch (e) {
      toast.error(getErrorMessage(e, 'Failed to load PDF'))
    }
  }

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
  }, [pdfUrl])

  const closePdf = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
    setPreviewPayslip(null)
  }

  const tabs = canManage
    ? [{ id: 'manage', label: 'Payroll Management' }, { id: 'mine', label: 'My Payslips' }]
    : [{ id: 'mine', label: 'My Payslips' }]

  const employeeName = (r: Payslip) => {
    const emp = r.employee
    if (emp) return `${emp.firstName || ''} ${emp.lastName || ''}`.trim()
    return `${r.firstName || ''} ${r.lastName || ''}`.trim() || '—'
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Payroll" description="Manage monthly payroll and view payslips" />

      {tab === 'manage' && canManage ? (
        <Card className="bg-muted/50 rounded-xl hover:shadow-md transition-shadow">
          <CardBody className="flex flex-wrap items-end gap-4">
            <Field label="Month">
              <Select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Year">
              <Input type="number" value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              {monthQuery.isLoading ? <LoadingState label="Checking month…" /> : null}
              {!monthQuery.isLoading && !payrollMonth ? (
                <Button onClick={() => initMonth.mutate()} disabled={initMonth.isPending}>
                  {initMonth.isPending ? 'Initializing…' : '1. Initialize Month'}
                </Button>
              ) : null}
              {payrollMonth?.status === 'PENDING' ? (
                <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
                  {generate.isPending ? 'Generating…' : '2. Generate Payslips'}
                </Button>
              ) : null}
              {payrollMonth?.status === 'COMPLETED' ? (
                <Badge status="approved">Month Closed</Badge>
              ) : payrollMonth ? (
                <Badge status="pending">Month Pending</Badge>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card className="bg-muted/50 rounded-xl hover:shadow-md transition-shadow">
          <CardBody className="flex flex-wrap items-end gap-4">
            <Field label="Month">
              <Select value={period.month} onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Year">
              <Input type="number" value={period.year} onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))} />
            </Field>
          </CardBody>
        </Card>
      )}

      <Card className="bg-muted/50 rounded-xl hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          {tabs.length > 1 ? <Tabs tabs={tabs} active={tab} onChange={setTab} /> : null}
          {payslips.isLoading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle="No payslips found"
              columns={[
                ...(tab === 'manage'
                  ? [
                      { key: 'employee', header: 'Employee Name', render: (r: Payslip) => employeeName(r) },
                      { key: 'code', header: 'Code', render: (r: Payslip) => r.employee?.employeeCode || r.employeeCode || '—' },
                    ]
                  : [
                      { key: 'period', header: 'Month', render: (r: Payslip) => monthName(r.month) },
                      { key: 'year', header: 'Year', render: (r: Payslip) => r.year },
                    ]),
                { key: 'net', header: 'Net Pay', render: (r: Payslip) => inr(r.netPay ?? r.netSalary) },
                ...(tab === 'manage'
                  ? [{ key: 'status', header: 'Status', render: (r: Payslip) => payslipStatusBadge(r.status) }]
                  : []),
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r: Payslip) => (
                    <div className="flex flex-wrap gap-2">
                      {tab === 'manage' && String(r.status).toUpperCase() === 'DRAFT' ? (
                        <Button size="sm" onClick={() => publish.mutate(r.id)} disabled={publish.isPending}>
                          Publish
                        </Button>
                      ) : null}
                      {String(r.status).toUpperCase() === 'PUBLISHED' ? (
                        <Button size="sm" variant="secondary" onClick={() => openPdf(r)}>View PDF</Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Modal open={Boolean(pdfUrl)} title={previewTitle} onClose={closePdf} wide>
        {previewPayslip?.breakdownJson ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Earnings</div>
              <div className="mt-3 space-y-2 text-sm">
                {(previewPayslip.breakdownJson.earnings || []).map((e) => (
                  <div key={e.name} className="flex items-center justify-between gap-4">
                    <div className="text-slate-600">{e.name}</div>
                    <div className="font-medium">{formatCurrency(e.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Deductions</div>
              <div className="mt-3 space-y-2 text-sm">
                {(previewPayslip.breakdownJson.deductions || []).map((d) => (
                  <div key={d.name} className="flex items-center justify-between gap-4">
                    <div className="text-slate-600">{d.name}</div>
                    <div className="font-medium">{formatCurrency(d.amount)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {pdfUrl ? (
          <div className="mt-4">
            <iframe src={pdfUrl} width="100%" height="800px" title="Payslip" className="rounded-lg border bg-white" />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
