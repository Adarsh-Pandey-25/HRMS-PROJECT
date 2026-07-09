import { format, parseISO } from 'date-fns'

export function formatDate(value?: string | null) {
  if (!value) return '—'
  try {
    return format(parseISO(value.split('T')[0]), 'dd MMM yyyy')
  } catch {
    return value
  }
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'dd MMM yyyy, hh:mm a')
  } catch {
    return value
  }
}

export function formatTime(value?: string | null) {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'hh:mm a')
  } catch {
    return value
  }
}

export function formatCurrency(amount?: number | null) {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

export function formatStatus(status?: string) {
  if (!status) return '—'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function monthName(month: number) {
  return format(new Date(2024, month - 1, 1), 'MMMM')
}
