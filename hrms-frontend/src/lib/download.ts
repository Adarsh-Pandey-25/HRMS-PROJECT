import { apiBase } from './api'
import { authStore } from '../store/auth'

export async function downloadAuthenticatedFile(path: string, filename?: string) {
  const token = authStore.getState().accessToken
  const res = await fetch(`${apiBase}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })

  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new Error(json?.error?.message || 'Download failed')
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await res.json()
    const url = json?.data?.url
    if (url) {
      window.open(url, '_blank')
      return
    }
  }

  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'download'
  a.click()
  window.URL.revokeObjectURL(url)
}

export async function downloadPayslip(id: string) {
  await downloadAuthenticatedFile(`/payroll/payslip/${id}/download`, `payslip-${id}.pdf`)
}

export async function downloadDocument(id: string, name?: string) {
  await downloadAuthenticatedFile(`/documents/${id}/download`, name || `document-${id}`)
}

export async function getDocumentPreviewUrl(id: string) {
  const token = authStore.getState().accessToken
  const res = await fetch(`${apiBase}/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })

  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw new Error(json?.error?.message || 'Failed to load document')
  }

  const json = await res.json()
  const url = json?.data?.url
  if (!url) throw new Error('Preview URL not available')
  return url as string
}
