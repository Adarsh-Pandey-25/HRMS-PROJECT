import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { authStore } from '../../store/auth'
import { isHROrAdmin } from '../../lib/permissions'
import { formatCurrency, formatStatus, monthName } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { downloadPayslip } from '../../lib/download'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, PageHeader, Select, Tabs } from '../../components/ui'
import type { Payslip } from '../../types'

export default function PayrollPage() {
  const qc = useQueryClient()
  const me = authStore((s) => s.me)
  const [tab, setTab] = useState(isHROrAdmin(me?.role) ? 'manage' : 'mine')
  const [generateForm, setGenerateForm] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  })

  const mine = useQuery({
    queryKey: ['payroll', 'mine'],
    queryFn: async () => (await api.get('/payroll/my-payslips')).data,
    enabled: tab === 'mine',
  })

  const report = useQuery({
    queryKey: ['payroll', 'report', generateForm.month, generateForm.year],
    queryFn: async () => (await api.get('/payroll/monthly-report', { params: generateForm })).data,
    enabled: tab === 'manage' && isHROrAdmin(me?.role),
  })

  const generate = useMutation({
    mutationFn: async () => (await api.post('/payroll/generate', generateForm)).data,
    onSuccess: () => {
      toast.success('Payroll generated')
      qc.invalidateQueries({ queryKey: ['payroll'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Payslip[] = tab === 'mine' ? mine.data?.data || [] : report.data?.data || []
  const loading = tab === 'mine' ? mine.isLoading : report.isLoading

  const handleDownload = async (id: string) => {
    try {
      await downloadPayslip(id)
    } catch {
      toast.error('Download failed')
    }
  }

  const tabs = isHROrAdmin(me?.role)
    ? [{ id: 'manage', label: 'Payroll Management' }, { id: 'mine', label: 'My Payslips' }]
    : [{ id: 'mine', label: 'My Payslips' }]

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Payroll" description="View payslips and manage payroll" />

      {tab === 'manage' && isHROrAdmin(me?.role) ? (
        <Card className="bg-muted/50 hover:shadow-md transition-shadow">
          <CardBody className="flex flex-wrap items-end gap-4">
            <Field label="Month">
              <Select value={generateForm.month} onChange={(e) => setGenerateForm((p) => ({ ...p, month: Number(e.target.value) }))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{monthName(m)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Year">
              <Input type="number" value={generateForm.year} onChange={(e) => setGenerateForm((p) => ({ ...p, year: Number(e.target.value) }))} />
            </Field>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? 'Generating…' : 'Generate Payroll'}
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
              emptyTitle="No payslips found"
              columns={[
                { key: 'period', header: 'Period', render: (r) => `${monthName(r.month)} ${r.year}` },
                { key: 'gross', header: 'Gross', render: (r) => formatCurrency(r.grossSalary) },
                { key: 'net', header: 'Net', render: (r) => formatCurrency(r.netSalary) },
                { key: 'status', header: 'Status', render: (r) => <Badge status={r.status}>{formatStatus(r.status)}</Badge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r) => <Button size="sm" variant="secondary" onClick={() => handleDownload(r.id)}>Download</Button>,
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
