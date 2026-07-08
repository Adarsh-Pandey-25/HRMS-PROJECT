import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  Wallet,
  Receipt,
  Users,
  PartyPopper,
  Megaphone,
  GraduationCap,
  FileText,
  BarChart3,
  Settings,
} from 'lucide-react'
import type { Role } from '../types'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/attendance', label: 'Attendance', icon: Clock, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/leaves', label: 'Leaves', icon: CalendarDays, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/payroll', label: 'Payroll', icon: Wallet, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/reimbursements', label: 'Reimbursements', icon: Receipt, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/employees', label: 'Employees', icon: Users, roles: ['admin', 'hr'] },
  { to: '/holidays', label: 'Holidays', icon: PartyPopper, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/announcements', label: 'Announcements', icon: Megaphone, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/training', label: 'Training', icon: GraduationCap, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/documents', label: 'Documents', icon: FileText, roles: ['admin', 'hr', 'manager', 'employee'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['admin', 'hr', 'manager'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
]

export const getNavForRole = (role?: Role) =>
  NAV_ITEMS.filter((item) => role && item.roles.includes(role))

export const hasRole = (role: Role | undefined, allowed: Role[]) =>
  Boolean(role && allowed.includes(role))

export const isHROrAdmin = (role?: Role) => hasRole(role, ['hr', 'admin'])
export const isManagerOrAbove = (role?: Role) => hasRole(role, ['manager', 'hr', 'admin'])
export const isAdmin = (role?: Role) => role === 'admin'
