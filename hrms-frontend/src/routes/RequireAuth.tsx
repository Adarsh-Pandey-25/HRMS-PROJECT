import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { authStore } from '../store/auth'

export default function RequireAuth() {
  const location = useLocation()
  const token = authStore((s) => s.accessToken)
  if (!token) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

