import { Navigate, Outlet } from 'react-router-dom'
import { authStore } from '../store/auth'
import type { Role } from '../types'

export default function RequireRole({ roles }: { roles: Role[] }) {
  const me = authStore((s) => s.me)
  if (!me || !roles.includes(me.role)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
