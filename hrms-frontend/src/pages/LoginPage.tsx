import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import api from '../lib/api'
import { authStore, type Me } from '../store/auth'
import { Button, Card, CardBody, Field, Input } from '../components/ui'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const setTokens = authStore((s) => s.setTokens)
  const setMe = authStore((s) => s.setMe)

  const defaults = useMemo<FormValues>(() => ({ email: '', password: '' }), [])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    mode: 'onSubmit',
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await api.post('/auth/login', values)
      const payload = res.data?.data
      if (!payload?.accessToken || !payload?.employee) {
        toast.error('Login failed')
        return
      }

      setTokens(payload.accessToken, payload.refreshToken)
      setMe(payload.employee as Me)

      const role = (payload.employee?.role || 'employee') as string
      toast.success(`Welcome back, ${payload.employee.firstName}!`)
      navigate(role === 'employee' ? '/attendance' : '/dashboard')
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Login failed')
    }
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-primary/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center text-white">
          <div className="text-3xl font-bold tracking-tight">HRMS</div>
          <p className="mt-2 text-slate-300">Human Resource Management System</p>
        </div>

        <Card>
          <CardBody className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
              <p className="text-sm text-slate-500 mt-1">Use your corporate email and password</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Email">
                <Input placeholder="you@company.com" {...form.register('email')} />
                {form.formState.errors.email ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.email.message}</p> : null}
              </Field>

              <Field label="Password">
                <Input type="password" placeholder="••••••••" {...form.register('password')} />
                {form.formState.errors.password ? <p className="mt-1 text-xs text-red-600">{form.formState.errors.password.message}</p> : null}
              </Field>

              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="flex items-center justify-end">
              <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
