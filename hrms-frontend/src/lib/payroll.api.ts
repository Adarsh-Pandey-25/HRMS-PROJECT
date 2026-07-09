import api from './api'
import type { PayrollMonth, Payslip } from '../types'

export async function initializePayrollMonth(month: number, year: number) {
  const res = await api.post('/payroll/months', { month, year })
  return res.data?.data as PayrollMonth
}

export async function getPayrollMonth(month: number, year: number) {
  const res = await api.get('/payroll/months', { params: { month, year } })
  return (res.data?.data ?? null) as PayrollMonth | null
}

export async function generatePayslips(payrollMonthId: string, userId?: string) {
  const res = await api.post('/payroll/payslips/generate', {
    payroll_month_id: payrollMonthId,
    ...(userId ? { user_id: userId } : {}),
  })
  return res.data?.data
}

export async function publishPayslip(id: string) {
  const res = await api.put(`/payroll/payslips/${id}/publish`)
  return res.data?.data as Payslip
}

export async function listPayslips(month: number, year: number) {
  const res = await api.get('/payroll/payslips', { params: { month, year } })
  return (res.data?.data || []) as Payslip[]
}

export async function downloadPayslipPdf(id: string) {
  const res = await api.get(`/payroll/payslips/${id}/download`, {
    responseType: 'blob',
  })
  return res.data as Blob
}
