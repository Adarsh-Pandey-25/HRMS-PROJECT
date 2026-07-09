import api from './api'

export type Notification = {
  id: string
  type: string
  title: string
  message: string
  link?: string | null
  meta?: any
  isRead?: boolean
  createdAt?: string
}

export async function listNotifications(unreadOnly = false) {
  const res = await api.get('/notifications', { params: unreadOnly ? { unread: 1, limit: 20 } : { limit: 20 } })
  return res.data
}

export async function unreadCount() {
  const res = await api.get('/notifications/unread-count')
  return res.data?.data?.count as number
}

export async function markNotificationRead(id: string) {
  const res = await api.put(`/notifications/${id}/read`)
  return res.data
}

export async function markAllRead() {
  const res = await api.put('/notifications/read-all')
  return res.data
}

