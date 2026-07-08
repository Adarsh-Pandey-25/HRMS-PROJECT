import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import api from '../lib/api'
import { getErrorMessage } from '../lib/errors'
import { Button, Card, CardBody, Field, Input } from '../components/ui'

const requestSchema = z.object({
  email: z.string().email('Enter a valid email'),
})

const resetSchema = z.object({
  email: z.string().email('Enter a valid email'),
  otp: z.string().min(4, 'OTP is required').max(10, 'Invalid OTP'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

type RequestValues = z.infer<typeof requestSchema>
type ResetValues = z.infer<typeof resetSchema>

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'request' | 'reset'>('request')
  const [sending, setSending] = useState(false)
  const [resetting, setResetting] = useState(false)

  const requestDefaults = useMemo<RequestValues>(() => ({ email: '' }), [])
  const resetDefaults = useMemo<ResetValues>(() => ({ email: '', otp: '', newPassword: '' }), [])

  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: requestDefaults,
    mode: 'onSubmit',
  })

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: resetDefaults,
    mode: 'onSubmit',
  })

  const onRequest = requestForm.handleSubmit(async ({ email }) => {
    try {
      setSending(true)
      await api.post('/auth/forgot-password', { email })
      toast.success('OTP sent (check inbox/spam)')
      setStep('reset')
      resetForm.setValue('email', email)
      resetForm.setFocus('otp')
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setSending(false)
    }
  })

  const onReset = resetForm.handleSubmit(async (values) => {
    try {
      setResetting(true)
      await api.post('/auth/reset-password', values)
      toast.success('Password updated. Please sign in.')
      navigate('/login')
    } catch (e) {
      toast.error(getErrorMessage(e))
    } finally {
      setResetting(false)
    }
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-primary/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center text-white">
          <div className="text-3xl font-bold tracking-tight">HRMS</div>
          <p className="mt-2 text-slate-300">Password recovery</p>
        </div>

        <Card>
          <CardBody className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Forgot password</h1>
              <p className="text-sm text-slate-500 mt-1">
                {step === 'request'
                  ? 'Enter your email to receive an OTP'
                  : 'Enter the OTP and set a new password'}
              </p>
            </div>

            {step === 'request' ? (
              <form onSubmit={onRequest} className="space-y-4">
                <Field label="Email">
                  <Input placeholder="you@company.com" {...requestForm.register('email')} />
                  {requestForm.formState.errors.email ? (
                    <p className="mt-1 text-xs text-red-600">{requestForm.formState.errors.email.message}</p>
                  ) : null}
                </Field>

                <Button type="submit" className="w-full" disabled={sending}>
                  {sending ? 'Sending OTP…' : 'Send OTP'}
                </Button>
              </form>
            ) : (
              <form onSubmit={onReset} className="space-y-4">
                <Field label="Email">
                  <Input placeholder="you@company.com" {...resetForm.register('email')} />
                  {resetForm.formState.errors.email ? (
                    <p className="mt-1 text-xs text-red-600">{resetForm.formState.errors.email.message}</p>
                  ) : null}
                </Field>

                <Field label="OTP">
                  <Input placeholder="6-digit OTP" inputMode="numeric" {...resetForm.register('otp')} />
                  {resetForm.formState.errors.otp ? (
                    <p className="mt-1 text-xs text-red-600">{resetForm.formState.errors.otp.message}</p>
                  ) : null}
                </Field>

                <Field label="New Password">
                  <Input type="password" placeholder="••••••••" {...resetForm.register('newPassword')} />
                  {resetForm.formState.errors.newPassword ? (
                    <p className="mt-1 text-xs text-red-600">{resetForm.formState.errors.newPassword.message}</p>
                  ) : null}
                </Field>

                <Button type="submit" className="w-full" disabled={resetting}>
                  {resetting ? 'Updating…' : 'Reset Password'}
                </Button>

                <button
                  type="button"
                  className="w-full text-sm text-slate-600 hover:text-slate-900"
                  onClick={() => setStep('request')}
                >
                  Back to send OTP
                </button>
              </form>
            )}

            <div className="text-center text-sm text-slate-600">
              <Link to="/login" className="font-medium text-primary hover:underline">Back to login</Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

