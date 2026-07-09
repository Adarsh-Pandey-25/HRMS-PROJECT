import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../lib/api'
import { getErrorMessage } from '../../lib/errors'
import { formatCurrency, formatStatus } from '../../lib/format'
import { createPayrollComponent, deletePayrollComponent, listPayrollComponents, updatePayrollComponent } from '../../lib/payrollComponents.api'
import { Badge, Button, Card, CardBody, DataTable, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs } from '../../components/ui'
import type { PayrollComponent, Setting } from '../../types'

export default function SettingsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'general' | 'leave'>('general')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PayrollComponent | null>(null)
  const [form, setForm] = useState({
    type: 'EARNING',
    name: '',
    method: 'fixed' as 'fixed' | 'formula',
    fixedAmount: '',
    targetField: 'basic_salary',
    operator: '%',
    operandField: '' as string,
    operandValue: '',
    outputField: '' as string,
    displayOrder: 0,
    isActive: true,
  })

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  })

  const components = useQuery({
    queryKey: ['settings', 'payroll-components'],
    queryFn: async () => await listPayrollComponents(),
  })

  const leavePolicy = useQuery({
    queryKey: ['settings', 'leave-policy'],
    queryFn: async () => (await api.get('/settings/leave-policy')).data,
  })

  const saveLeavePolicy = useMutation({
    mutationFn: async (policy: any[]) =>
      (await api.put('/settings/leave-policy', { policy })).data,
    onSuccess: () => {
      toast.success('Leave policy updated')
      qc.invalidateQueries({ queryKey: ['settings', 'leave-policy'] })
      qc.invalidateQueries({ queryKey: ['leaves', 'types'] })
      qc.invalidateQueries({ queryKey: ['leaves', 'balance'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const applyLeavePolicy = useMutation({
    mutationFn: async ({ year, policy }: { year: number; policy: any[] }) =>
      (await api.post('/settings/leave-policy/apply', { policy }, { params: { year } })).data,
    onSuccess: () => {
      toast.success('Applied to all employees')
      qc.invalidateQueries({ queryKey: ['leaves', 'types'] })
      qc.invalidateQueries({ queryKey: ['leaves', 'balance'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })
  const update = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) =>
      (await api.put(`/settings/${key}`, { value })).data,
    onSuccess: () => {
      toast.success('Setting updated')
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const saveComponent = useMutation({
    mutationFn: async () => {
      const payload: Partial<PayrollComponent> & { type: string; name: string } = {
        type: form.type as any,
        name: form.name,
        isFixed: form.method === 'fixed',
        fixedAmount: form.method === 'fixed' ? Number(form.fixedAmount || 0) : null,
        targetField: form.method === 'formula' ? form.targetField : null,
        operator: form.method === 'formula' ? form.operator : null,
        operandField: form.method === 'formula' ? (form.operandField || null) : null,
        operandValue: form.method === 'formula' ? Number(form.operandValue || 0) : null,
        outputField: form.outputField || null,
        displayOrder: Number(form.displayOrder || 0),
        isActive: form.isActive,
      }
      if (editing) return await updatePayrollComponent(editing.id, payload)
      return await createPayrollComponent(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Component updated' : 'Component added')
      qc.invalidateQueries({ queryKey: ['settings', 'payroll-components'] })
      setOpen(false)
      setEditing(null)
      setForm({
        type: 'EARNING',
        name: '',
        method: 'fixed',
        fixedAmount: '',
        targetField: 'basic_salary',
        operator: '%',
        operandField: '',
        operandValue: '',
        outputField: '',
        displayOrder: 0,
        isActive: true,
      })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const removeComponent = useMutation({
    mutationFn: async (id: string) => await deletePayrollComponent(id),
    onSuccess: () => {
      toast.success('Component deleted')
      qc.invalidateQueries({ queryKey: ['settings', 'payroll-components'] })
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Setting[] = (settings.data?.data || [])
    .filter((s: Setting) => s.key !== 'monthly_reimbursement_limit')
    .map((s: Setting) => ({ ...s, id: s.key }))

  const componentRows = components.data || []

  const tabs = useMemo(() => ([
    { id: 'general', label: 'General Settings' },
    { id: 'leave', label: 'Leave Policy' },
  ]), [])

  const openCreate = () => {
    setEditing(null)
    setForm({
      type: 'EARNING',
      name: '',
      method: 'fixed',
      fixedAmount: '',
      targetField: 'basic_salary',
      operator: '%',
      operandField: '',
      operandValue: '',
      outputField: '',
      displayOrder: 0,
      isActive: true,
    })
    setOpen(true)
  }

  const openEdit = (c: PayrollComponent) => {
    setEditing(c)
    setForm({
      type: c.type,
      name: c.name,
      method: c.isFixed ? 'fixed' : 'formula',
      fixedAmount: c.fixedAmount != null ? String(c.fixedAmount) : '',
      targetField: c.targetField || 'basic_salary',
      operator: c.operator || '%',
      operandField: c.operandField || '',
      operandValue: c.operandValue != null ? String(c.operandValue) : '',
      outputField: c.outputField || '',
      displayOrder: c.displayOrder || 0,
      isActive: c.isActive !== false,
    })
    setOpen(true)
  }

  const ruleLabel = (c: PayrollComponent) => {
    if (c.isFixed) return `Fixed ${formatCurrency(Number(c.fixedAmount || 0))}`
    const target = c.targetField ? formatStatus(c.targetField) : '—'
    const op = c.operator || '—'
    const operandField = c.operandField ? formatStatus(c.operandField) : null
    const value = c.operandValue != null ? c.operandValue : '—'
    if (op === '%') return `${value}% of ${target}`
    if (operandField) return `${target} ${op} ${operandField}`
    return `${target} ${op} ${value}`
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="System Settings" description="Configure application behavior (Admin only)" />

      <Card className="bg-muted/50 hover:shadow-md transition-shadow">
        <CardBody className="space-y-4">
          <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as any)} />

          {tab === 'general' ? (
            settings.isLoading ? <LoadingState /> : (
              <div className="space-y-4">
                <Card className="bg-white">
                  <CardBody className="space-y-3">
                    <div className="text-sm font-semibold text-slate-900">Payroll Settings</div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Working Days / Month">
                        <Input
                          type="number"
                          defaultValue={String((rows.find((r) => r.key === 'payroll_working_days')?.value ?? 23))}
                          onBlur={(e) => update.mutate({ key: 'payroll_working_days', value: e.target.value })}
                        />
                      </Field>
                      <Field label="PF Rate (e.g. 0.12)">
                        <Input
                          type="number"
                          step="0.0001"
                          defaultValue={String((rows.find((r) => r.key === 'payroll_pf_rate')?.value ?? 0.12))}
                          onBlur={(e) => update.mutate({ key: 'payroll_pf_rate', value: e.target.value })}
                        />
                      </Field>
                      <Field label="Professional Tax (₹)">
                        <Input
                          type="number"
                          defaultValue={String((rows.find((r) => r.key === 'payroll_professional_tax')?.value ?? 200))}
                          onBlur={(e) => update.mutate({ key: 'payroll_professional_tax', value: e.target.value })}
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        defaultChecked={String(rows.find((r) => r.key === 'payroll_halfday_before_goal_enabled')?.value ?? 'false') === 'true'}
                        onChange={(e) => update.mutate({ key: 'payroll_halfday_before_goal_enabled', value: e.target.checked ? 'true' : 'false' })}
                      />
                      Mark as <span className="font-semibold">Half Day</span> if checkout is before 9 hours (affects payroll deduction)
                    </label>
                    <div className="text-xs text-slate-600">
                      These values are used in payroll generation immediately (no code changes needed later).
                    </div>
                  </CardBody>
                </Card>

                <Card className="bg-white border">
                  <CardBody className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Payroll Components</div>
                        <div className="text-xs text-slate-600">Add earnings/deductions (fixed or %) for auto calculation.</div>
                      </div>
                      <Button onClick={openCreate}>Add Component</Button>
                    </div>

                    {components.isLoading ? <LoadingState /> : (
                      <DataTable<PayrollComponent>
                        rows={componentRows}
                        emptyTitle="No payroll components configured"
                        columns={[
                          { key: 'type', header: 'Type', render: (r) => r.type === 'EARNING' ? <Badge status="approved">Earning</Badge> : <Badge status="rejected">Deduction</Badge> },
                          { key: 'name', header: 'Name', render: (r) => r.name },
                          { key: 'rule', header: 'Rule', render: (r) => <span className="text-slate-700">{ruleLabel(r)}</span> },
                          { key: 'order', header: 'Order', render: (r) => r.displayOrder },
                          { key: 'active', header: 'Active', render: (r) => r.isActive ? <Badge status="active">Yes</Badge> : <Badge status="cancelled">No</Badge> },
                          {
                            key: 'actions',
                            header: 'Actions',
                            render: (r) => (
                              <div className="flex gap-2">
                                <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button>
                                <Button size="sm" variant="danger" onClick={() => removeComponent.mutate(r.id)} disabled={removeComponent.isPending}>Delete</Button>
                              </div>
                            ),
                          },
                        ]}
                      />
                    )}
                  </CardBody>
                </Card>

                <DataTable<Setting>
                  rows={rows}
                  emptyTitle="No settings found"
                  columns={[
                    { key: 'key', header: 'Key', render: (r) => <code className="text-xs bg-slate-100 px-2 py-1 rounded">{r.key}</code> },
                    { key: 'value', header: 'Value', render: (r) => (
                      <Input
                        defaultValue={r.value}
                        onBlur={(e) => {
                          if (e.target.value !== r.value) update.mutate({ key: r.key, value: e.target.value })
                        }}
                      />
                    ) },
                    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
                  ]}
                />
              </div>
            )
          ) : (
            <Card className="bg-white border">
              <CardBody className="space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Leave Policy (Yearly Allocations)</div>
                  <div className="text-xs text-slate-600">Update total allocated leave days for each leave type.</div>
                </div>

                {leavePolicy.isLoading ? <LoadingState /> : (
                  <LeavePolicyEditorV2
                    initial={leavePolicy.data?.data || null}
                    onSave={(policy) => saveLeavePolicy.mutate(policy)}
                    saving={saveLeavePolicy.isPending}
                    onApplyToAll={(year, policy) => applyLeavePolicy.mutate({ year, policy })}
                    applying={applyLeavePolicy.isPending}
                  />
                )}
              </CardBody>
            </Card>
          )}
        </CardBody>
      </Card>

      <Modal open={open} title={editing ? 'Edit Component' : 'Add Component'} onClose={() => { setOpen(false); setEditing(null) }}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}>
                <option value="EARNING">Earning</option>
                <option value="DEDUCTION">Deduction</option>
              </Select>
            </Field>
            <Field label="Display Order">
              <Input type="number" value={form.displayOrder} onChange={(e) => setForm((p) => ({ ...p, displayOrder: Number(e.target.value) }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </Field>
            </div>
          </div>

          <div className="rounded-lg border bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-700">Calculation Method</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.method === 'fixed'} onChange={() => setForm((p) => ({ ...p, method: 'fixed' }))} />
                Fixed Amount
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.method === 'formula'} onChange={() => setForm((p) => ({ ...p, method: 'formula' }))} />
                Formula
              </label>
            </div>
          </div>

          {form.method === 'fixed' ? (
            <Field label="Amount (₹)">
              <Input type="number" value={form.fixedAmount} onChange={(e) => setForm((p) => ({ ...p, fixedAmount: e.target.value }))} />
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Target">
                <Select value={form.targetField} onChange={(e) => setForm((p) => ({ ...p, targetField: e.target.value }))}>
                  <option value="basic_salary">Basic Salary</option>
                  <option value="gross_salary">Gross Salary</option>
                  <option value="employee_basic">Employee Basic (Profile)</option>
                  <option value="employee_hra">Employee HRA (Profile)</option>
                  <option value="unpaid_leave_days">Unpaid Leave Days</option>
                  <option value="working_days">Working Days (23)</option>
                </Select>
              </Field>
              <Field label="Operator">
                <Select value={form.operator} onChange={(e) => setForm((p) => ({ ...p, operator: e.target.value }))}>
                  <option value="%">%</option>
                  <option value="*">*</option>
                  <option value="/">/</option>
                  <option value="+">+</option>
                  <option value="-">-</option>
                </Select>
              </Field>
              <Field label="Value / Field">
                <Select value={form.operandField} onChange={(e) => setForm((p) => ({ ...p, operandField: e.target.value }))}>
                  <option value="">Use numeric value</option>
                  <option value="basic_salary">Basic Salary</option>
                  <option value="gross_salary">Gross Salary</option>
                  <option value="employee_basic">Employee Basic (Profile)</option>
                  <option value="employee_hra">Employee HRA (Profile)</option>
                  <option value="unpaid_leave_days">Unpaid Leave Days</option>
                  <option value="working_days">Working Days (23)</option>
                </Select>
                {!form.operandField ? (
                  <div className="mt-2">
                    <Input type="number" value={form.operandValue} onChange={(e) => setForm((p) => ({ ...p, operandValue: e.target.value }))} />
                  </div>
                ) : null}
              </Field>
            </div>
          )}

          <Field label="Store result as (optional)">
            <Input
              placeholder="e.g. basic_salary, hra, gross_per_day, lop_deduction"
              value={form.outputField}
              onChange={(e) => setForm((p) => ({ ...p, outputField: e.target.value }))}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))} />
            Active
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={() => saveComponent.mutate()} disabled={saveComponent.isPending || !form.name}>
              {saveComponent.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function LeavePolicyEditorV2({
  initial,
  onSave,
  saving,
  onApplyToAll,
  applying,
}: {
  initial: any
  onSave: (policy: Array<{ code: string; name: string; allocation: number; active: boolean }>) => void
  saving: boolean
  onApplyToAll: (year: number, policy: Array<{ code: string; name: string; allocation: number; active: boolean }>) => void
  applying: boolean
}) {
  const defaultPolicy = [
    { code: 'CL', name: 'Casual Leave', allocation: 12, active: true },
    { code: 'SL', name: 'Sick Leave', allocation: 12, active: true },
    { code: 'EL', name: 'Earned Leave', allocation: 15, active: true },
    { code: 'WFH', name: 'Work From Home', allocation: 0, active: true },
    { code: 'COMP_OFF', name: 'Comp Off', allocation: 0, active: true },
    { code: 'MATERNITY', name: 'Maternity Leave', allocation: 0, active: true },
    { code: 'PATERNITY', name: 'Paternity Leave', allocation: 0, active: true },
    { code: 'UNPAID', name: 'Unpaid Leave', allocation: 0, active: true },
  ]

  const [policy, setPolicy] = useState<Array<{ code: string; name: string; allocation: number; active: boolean }>>(
    Array.isArray(initial) && initial.length ? initial : defaultPolicy
  )
  const [year, setYear] = useState(new Date().getFullYear())
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')

  const normalizeCode = (v: string) =>
    v
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')

  const add = () => {
    const code = normalizeCode(newCode)
    if (!code) return
    const exists = policy.some((p) => p.code === code)
    if (exists) return
    setPolicy((p) => [...p, { code, name: (newName || formatStatus(code)).trim(), allocation: 0, active: true }])
    setNewCode('')
    setNewName('')
  }

  const remove = (code: string) => {
    // "Delete" means disable for all employees
    setPolicy((p) => p.map((x) => x.code === code ? { ...x, active: false, allocation: 0 } : x))
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Apply For Year">
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </Field>
        <div className="sm:col-span-2 flex items-end justify-end gap-2">
          <Button variant="secondary" onClick={() => onApplyToAll(year, policy)} disabled={applying}>
            {applying ? 'Applying…' : 'Apply to all employees'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-slate-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Leave Code (e.g. BEREAVEMENT)">
            <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="BEREAVEMENT" />
          </Field>
          <Field label="Display Name">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bereavement Leave" />
          </Field>
          <Button onClick={add} disabled={!newCode.trim()}>Add</Button>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          Tip: Code will be auto-normalized to UPPER_SNAKE_CASE.
        </div>
      </div>

      <div className="grid gap-3">
        {policy.map((p) => (
          <div key={p.code} className="rounded-lg border bg-white p-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Code">
                <Input value={p.code} disabled />
              </Field>
              <Field label="Name">
                <Input value={p.name} onChange={(e) => setPolicy((arr) => arr.map((x) => x.code === p.code ? { ...x, name: e.target.value } : x))} />
              </Field>
              <Field label="Allocation">
                <Input type="number" value={p.allocation} onChange={(e) => setPolicy((arr) => arr.map((x) => x.code === p.code ? { ...x, allocation: Number(e.target.value) } : x))} />
              </Field>
              <div className="flex items-end justify-end gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={p.active} onChange={(e) => setPolicy((arr) => arr.map((x) => x.code === p.code ? { ...x, active: e.target.checked } : x))} />
                  Active
                </label>
                <Button variant="danger" size="sm" onClick={() => remove(p.code)}>Delete</Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={() => onSave(policy)} disabled={saving}>
          {saving ? 'Saving…' : 'Save Leave Policy'}
        </Button>
      </div>
      <div className="text-xs text-slate-500">
        Tip: Save → Apply to all employees to update existing balances immediately.
      </div>
    </div>
  )
}
