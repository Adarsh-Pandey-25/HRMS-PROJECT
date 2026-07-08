import { create } from 'zustand'

type Role = 'admin' | 'hr' | 'manager' | 'employee'

export type Me = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: Role
  employeeCode?: string
}

type AuthState = {
  accessToken: string | null
  refreshToken: string | null
  me: Me | null
  setTokens: (access: string, refresh?: string) => void
  setMe: (me: Me) => void
  logout: () => void
}

const LS_ACCESS = 'hrms_access_token'
const LS_REFRESH = 'hrms_refresh_token'
const LS_ME = 'hrms_me'

const readJson = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export const authStore = create<AuthState>((set) => ({
  accessToken: localStorage.getItem(LS_ACCESS),
  refreshToken: localStorage.getItem(LS_REFRESH),
  me: readJson<Me>(LS_ME),

  setTokens: (access, refresh) => {
    localStorage.setItem(LS_ACCESS, access)
    if (refresh) localStorage.setItem(LS_REFRESH, refresh)
    set({ accessToken: access, refreshToken: refresh ?? localStorage.getItem(LS_REFRESH) })
  },

  setMe: (me) => {
    localStorage.setItem(LS_ME, JSON.stringify(me))
    set({ me })
  },

  logout: () => {
    localStorage.removeItem(LS_ACCESS)
    localStorage.removeItem(LS_REFRESH)
    localStorage.removeItem(LS_ME)
    set({ accessToken: null, refreshToken: null, me: null })
  },
}))

