import api from './api'
import type { PayrollComponent } from '../types'

export async function listPayrollComponents() {
  const res = await api.get('/settings/payroll-components')
  return (res.data?.data || []) as PayrollComponent[]
}

export async function createPayrollComponent(payload: Partial<PayrollComponent> & { type: string; name: string }) {
  const res = await api.post('/settings/payroll-components', {
    type: payload.type,
    name: payload.name,
    is_fixed: Boolean(payload.isFixed),
    fixed_amount: payload.fixedAmount ?? null,
    target_field: payload.targetField ?? null,
    operator: payload.operator ?? null,
    operand_field: payload.operandField ?? null,
    operand_value: payload.operandValue ?? null,
    output_field: payload.outputField ?? null,
    display_order: payload.displayOrder ?? 0,
    is_active: payload.isActive !== false,
  })
  return res.data?.data as PayrollComponent
}

export async function updatePayrollComponent(id: string, payload: Partial<PayrollComponent> & { type: string; name: string }) {
  const res = await api.put(`/settings/payroll-components/${id}`, {
    type: payload.type,
    name: payload.name,
    is_fixed: Boolean(payload.isFixed),
    fixed_amount: payload.fixedAmount ?? null,
    target_field: payload.targetField ?? null,
    operator: payload.operator ?? null,
    operand_field: payload.operandField ?? null,
    operand_value: payload.operandValue ?? null,
    output_field: payload.outputField ?? null,
    display_order: payload.displayOrder ?? 0,
    is_active: payload.isActive !== false,
  })
  return res.data?.data as PayrollComponent
}

export async function deletePayrollComponent(id: string) {
  const res = await api.delete(`/settings/payroll-components/${id}`)
  return res.data
}

