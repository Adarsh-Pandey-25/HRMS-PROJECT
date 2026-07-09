import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Menu, X } from 'lucide-react'
import { authStore } from '../../store/auth'
import { getNavForRole } from '../../lib/permissions'
import api from '../../lib/api'
import { listNotifications, markAllRead, markNotificationRead, unreadCount } from '../../lib/notifications.api'

export default function AppLayout() {
  const navigate = useNavigate()
  const me = authStore((s) => s.me)
  const setMe = authStore((s) => s.setMe)
  const logout = authStore((s) => s.logout)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    api.get('/auth/me').then((res) => {
      if (res.data?.data) setMe(res.data.data)
    }).catch(() => {})
  }, [setMe])

  useEffect(() => {
    let t: any
    const load = async () => {
      try {
        const c = await unreadCount()
        setUnread(Number(c || 0))
      } catch {}
    }
    load()
    t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  const openNotifications = async () => {
    setNotifOpen((v) => !v)
    try {
      const res = await listNotifications(false)
      setItems(res?.data || [])
      const c = await unreadCount()
      setUnread(Number(c || 0))
    } catch {}
  }

  const onClickNotif = async (n: any) => {
    try {
      if (!n?.isRead && n?.id) await markNotificationRead(n.id)
      const c = await unreadCount()
      setUnread(Number(c || 0))
    } catch {}
    setNotifOpen(false)
    const link = n?.link
    if (link) navigate(link)
  }

  const onReadAll = async () => {
    try {
      await markAllRead()
      setUnread(0)
      const res = await listNotifications(false)
      setItems(res?.data || [])
    } catch {}
  }

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
            <div className="ml-auto relative">
              <button
                className="relative rounded-lg border p-2 hover:bg-slate-50"
                onClick={openNotifications}
                aria-label="Notifications"
              >
                <Bell className="size-5 text-slate-700" />
                {unread > 0 ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </button>

              {notifOpen ? (
                <div className="absolute right-0 mt-2 w-[360px] rounded-xl border bg-white shadow-xl overflow-hidden z-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <div className="text-sm font-semibold text-slate-900">Notifications</div>
                    <button onClick={onReadAll} className="text-xs font-medium text-primary hover:underline">
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    {items?.length ? items.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => onClickNotif(n)}
                        className={`w-full text-left px-4 py-3 border-b hover:bg-slate-50 ${n.isRead ? '' : 'bg-blue-50/40'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                          <div className="text-[10px] uppercase text-slate-500">{n.type}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-600 line-clamp-2">{n.message}</div>
                      </button>
                    )) : (
                      <div className="px-4 py-8 text-sm text-slate-500 text-center">No notifications</div>
                    )}
                  </div>
                </div>
              ) : null}
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
