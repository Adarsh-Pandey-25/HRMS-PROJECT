import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { formatStatus } from '../../lib/format'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select } from '../../components/ui'
import type { Employee } from '../../types'

export default function EmployeesPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'employee',
    department: '',
    designation: '',
    managerId: '',
    basic: '',
    hra: '',
  })

  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: async () => (await api.get('/employees/all', { params: { limit: 50 } })).data,
  })

  const managers = useQuery({
    queryKey: ['employees', 'managers'],
    queryFn: async () => (await api.get('/employees/all', { params: { role: 'manager', limit: 100, is_active: true } })).data,
    enabled: open,
  })

  const create = useMutation({
    mutationFn: async () => {
      const payload: any = {
        email: form.email,
        first_name: form.firstName,
        last_name: form.lastName,
        role: form.role,
        department: form.department,
        designation: form.designation,
      }
      if (form.role === 'employee' && form.managerId) {
        payload.manager_id = form.managerId
      }
      const basic = Number(form.basic || 0)
      const hra = Number(form.hra || 0)
      if (basic || hra) {
        payload.salary_details = { basic, hra }
      }
      return (await api.post('/employees/create', payload)).data
    },
    onSuccess: (res) => {
      const tempPassword = res?.data?.tempPassword
      toast.success(tempPassword ? `Employee created. Password: ${tempPassword}` : 'Employee created')
      qc.invalidateQueries({ queryKey: ['employees'] })
      setOpen(false)
      setForm({ email: '', firstName: '', lastName: '', role: 'employee', department: '', designation: '', managerId: '', basic: '', hra: '' })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const deactivate = useMutation({
    mutationFn: async (id: string) => (await api.put(`/employees/${id}/deactivate`)).data,
    onSuccess: () => {
      toast.success('Employee deactivated')
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Employee[] = employees.data?.data || []
  const managerOptions: Employee[] = managers.data?.data || []

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Employees"
        description="Manage employee directory"
        action={<Button onClick={() => setOpen(true)}>Add Employee</Button>}
      />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody>
          {employees.isLoading ? <LoadingState /> : (
            <DataTable
              rows={rows}
              emptyTitle="No employees found"
              columns={[
                { key: 'code', header: 'Code', render: (r) => r.employeeCode || '—' },
                { key: 'name', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
                { key: 'email', header: 'Email', render: (r) => r.email },
                { key: 'department', header: 'Department', render: (r) => r.department || '—' },
                {
                  key: 'manager',
                  header: 'Reporting Manager',
                  render: (r) => {
                    const mgr = (r as Employee & { manager?: { firstName?: string; lastName?: string } }).manager
                    return mgr ? `${mgr.firstName || ''} ${mgr.lastName || ''}`.trim() : '—'
                  },
                },
                { key: 'role', header: 'Role', render: (r) => <Badge status={r.role}>{formatStatus(r.role)}</Badge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (r) => r.isActive !== false ? (
                    <Button size="sm" variant="danger" onClick={() => deactivate.mutate(r.id)}>Deactivate</Button>
                  ) : <Badge status="cancelled">Inactive</Badge>,
                },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Modal open={open} title="Add Employee" onClose={() => setOpen(false)} wide>
        <div className="space-y-4">
          <Field label="Email"><Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First Name"><Input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} /></Field>
            <Field label="Last Name"><Input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} /></Field>
          </div>
          <Field label="Role">
            <Select
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value, managerId: e.target.value === 'employee' ? p.managerId : '' }))}
            >
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="hr">HR</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>

          {form.role === 'employee' ? (
            <Field label="Reporting Manager">
              <Select
                value={form.managerId}
                onChange={(e) => setForm((p) => ({ ...p, managerId: e.target.value }))}
              >
                <option value="">Select manager (optional)</option>
                {managerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firstName} {m.lastName} {m.department ? `— ${m.department}` : ''}
                  </option>
                ))}
              </Select>
              {managers.isLoading ? <p className="mt-1 text-xs text-slate-500">Loading managers…</p> : null}
              {!managers.isLoading && managerOptions.length === 0 ? (
                <p className="mt-1 text-xs text-amber-600">No managers found. Create a manager first.</p>
              ) : null}
            </Field>
          ) : null}

          <Field label="Department"><Input value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))} /></Field>
          <Field label="Designation"><Input value={form.designation} onChange={(e) => setForm((p) => ({ ...p, designation: e.target.value }))} /></Field>

          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">Salary Details</div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Basic Salary (₹)">
                <Input type="number" value={form.basic} onChange={(e) => setForm((p) => ({ ...p, basic: e.target.value }))} />
              </Field>
              <Field label="HRA (₹)">
                <Input type="number" value={form.hra} onChange={(e) => setForm((p) => ({ ...p, hra: e.target.value }))} />
              </Field>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              These values are used for payroll calculation (Gross = Basic + HRA).
            </div>
          </div>

          <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Employee'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
