import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { authStore } from '../../store/auth'
import { getNavForRole } from '../../lib/permissions'
import api from '../../lib/api'

export default function AppLayout() {
  const navigate = useNavigate()
  const me = authStore((s) => s.me)
  const setMe = authStore((s) => s.setMe)
  const logout = authStore((s) => s.logout)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    api.get('/auth/me').then((res) => {
      if (res.data?.data) setMe(res.data.data)
    }).catch(() => {})
  }, [setMe])

  const navItems = getNavForRole(me?.role)

  const sidebar = (
    <>
      <div className="flex items-center justify-between px-4 py-5">
        <div>
          <div className="text-lg font-bold tracking-tight text-white">HRMS</div>
          <div className="text-xs text-slate-400">Human Resources</div>
        </div>
        <button className="md:hidden text-slate-300" onClick={() => setMobileOpen(false)}>
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-primary text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-slate-800 p-4">
        <div className="rounded-lg bg-slate-800/60 p-3">
          <div className="text-sm font-medium text-white">{me ? `${me.firstName} ${me.lastName}` : '—'}</div>
          <div className="text-xs text-slate-400 truncate">{me?.email}</div>
          <div className="mt-2 inline-flex rounded-md bg-slate-700 px-2 py-0.5 text-xs capitalize text-slate-200">
            {me?.role || 'employee'}
          </div>
          <button
            onClick={() => {
              logout()
              navigate('/login')
            }}
            className="mt-3 w-full rounded-lg bg-white py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
          >
            Logout
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex min-h-screen">
        <aside className="hidden md:flex w-64 shrink-0 flex-col bg-slate-900">{sidebar}</aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <aside className="relative z-10 flex h-full w-72 flex-col bg-slate-900">{sidebar}</aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-white px-4 py-3 md:px-6">
            <button className="md:hidden rounded-lg border p-2" onClick={() => setMobileOpen(true)}>
              <Menu className="size-5" />
            </button>
            <div className="text-sm text-slate-500">
              Welcome back, <span className="font-medium text-slate-800">{me?.firstName || 'User'}</span>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
