import axios, { AxiosError } from 'axios'
import { camelize } from './case'
import { authStore } from '../store/auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  withCredentials: true,
})

export const apiBase = api.defaults.baseURL || 'http://localhost:5000/api'

api.interceptors.request.use((config) => {
  const token = authStore.getState().accessToken
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    // Convert backend snake_case -> camelCase for frontend
    response.data = camelize(response.data)
    return response
  },
  async (error: AxiosError<any>) => {
    const status = error.response?.status
    const original = error.config as any

    if (status === 401 && !original?._retry) {
      original._retry = true
      try {
        const refreshToken = authStore.getState().refreshToken
        const res = await api.post('/auth/refresh-token', refreshToken ? { refreshToken } : {})
        const payload = res.data?.data
        if (payload?.accessToken) {
          authStore.getState().setTokens(payload.accessToken, payload.refreshToken)
          original.headers = original.headers ?? {}
          original.headers.Authorization = `Bearer ${payload.accessToken}`
          return api(original)
        }
      } catch {
        authStore.getState().logout()
        window.location.href = '/login'
      }
    }

    // Ensure error bodies are camelized too
    if (error.response?.data) {
      error.response.data = camelize(error.response.data)
    }
    return Promise.reject(error)
  }
)

export default api

