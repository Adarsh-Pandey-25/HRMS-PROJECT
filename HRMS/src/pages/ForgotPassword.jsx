import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, KeyRound, Mail, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input } from '../components/ui';
import { forgotPasswordApi, resetPasswordApi } from '../api/auth.api';

const emailSchema = z.object({
  email: z.string().email('Enter a valid work email'),
});

const resetSchema = z.object({
  email: z.string().email('Enter a valid work email'),
  otp: z.string().min(4, 'Enter the OTP from your email').max(10),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm your password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m <= 0) return `${sec}s`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function useCountdown(untilMs) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!untilMs || untilMs <= Date.now()) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [untilMs]);

  const remaining = untilMs ? Math.max(0, Math.ceil((untilMs - now) / 1000)) : 0;
  return remaining;
}

function applyLockFromError(err, setLockUntil) {
  const details = err?.details;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const retrySec = Number(details.retryAfterSeconds || 0);
    const until = details.lockedUntil
      ? Number(details.lockedUntil)
      : details.nextResendAt
        ? Number(details.nextResendAt)
        : retrySec > 0
          ? Date.now() + retrySec * 1000
          : 0;
    if (until > Date.now()) setLockUntil(until);
    if (details.nextResendAt) return Number(details.nextResendAt);
  }
  return null;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [resendUntil, setResendUntil] = useState(0);

  const lockRemaining = useCountdown(lockUntil);
  const resendRemaining = useCountdown(resendUntil);
  const isLocked = lockRemaining > 0;
  const canResend = resendRemaining <= 0 && !isLocked;

  const emailForm = useForm({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  const resetForm = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: '', otp: '', newPassword: '', confirmPassword: '' },
  });

  const sendOtp = async ({ email }) => {
    if (isLocked) {
      toast.error(`Too many wrong OTPs. Wait ${formatCountdown(lockRemaining)}.`);
      return;
    }
    if (resendRemaining > 0) {
      toast.error(`Wait ${formatCountdown(resendRemaining)} before sending another code.`);
      return;
    }
    setSending(true);
    try {
      const data = await forgotPasswordApi(email);
      resetForm.setValue('email', email);
      const nextAt = data?.nextResendAt ? Number(data.nextResendAt) : (
        data?.retryAfterSeconds ? Date.now() + Number(data.retryAfterSeconds) * 1000 : 0
      );
      if (nextAt) setResendUntil(nextAt);
      setStep('reset');
      toast.success('If that email is registered, an OTP was sent. Check your inbox.');
    } catch (err) {
      const next = applyLockFromError(err, setLockUntil);
      if (next) setResendUntil(next);
      toast.error(err.message || 'Could not send reset email');
    } finally {
      setSending(false);
    }
  };

  const resetPassword = async (values) => {
    if (isLocked) {
      toast.error(`Too many wrong OTPs. Wait ${formatCountdown(lockRemaining)}.`);
      return;
    }
    setResetting(true);
    try {
      await resetPasswordApi({
        email: values.email,
        otp: values.otp,
        newPassword: values.newPassword,
      });
      toast.success('Password updated — sign in with your new password');
      navigate('/login', { replace: true });
    } catch (err) {
      applyLockFromError(err, setLockUntil);
      toast.error(err.message || 'Reset failed — check OTP and try again');
    } finally {
      setResetting(false);
    }
  };

  const resendCode = async () => {
    const email = resetForm.getValues('email');
    if (!email) {
      setStep('email');
      return;
    }
    await sendOtp({ email });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-light via-page to-primary-light px-4 animate-fade-in">
      <div className="w-full max-w-sm">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>

        <div className="text-center mb-6">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-card-hover">
            <KeyRound className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Reset your password</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {step === 'email'
              ? 'We’ll email a one-time code to your work address.'
              : 'Enter the OTP from your email and choose a new password.'}
          </p>
        </div>

        <Card className="p-6">
          {step === 'email' ? (
            <form onSubmit={emailForm.handleSubmit(sendOtp)} className="space-y-4">
              <Input
                label="Work email"
                type="email"
                required
                placeholder="e.g. admin@company.com"
                icon={Mail}
                {...emailForm.register('email')}
                error={emailForm.formState.errors.email?.message}
              />
              {(isLocked || resendRemaining > 0) && (
                <p className="text-xs text-warning text-center">
                  {isLocked
                    ? `Locked after wrong OTPs — wait ${formatCountdown(lockRemaining)}`
                    : `You can request a code again in ${formatCountdown(resendRemaining)}`}
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                icon={Send}
                loading={sending}
                disabled={sending || isLocked || resendRemaining > 0}
              >
                {isLocked
                  ? `Try again in ${formatCountdown(lockRemaining)}`
                  : resendRemaining > 0
                    ? `Wait ${formatCountdown(resendRemaining)}`
                    : 'Send reset code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={resetForm.handleSubmit(resetPassword)} className="space-y-4">
              <Input
                label="Work email"
                type="email"
                required
                {...resetForm.register('email')}
                error={resetForm.formState.errors.email?.message}
              />
              <div className="space-y-1.5">
                <Input
                  label="OTP code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code from email"
                  maxLength={10}
                  disabled={isLocked}
                  {...resetForm.register('otp')}
                  error={resetForm.formState.errors.otp?.message}
                />
                <button
                  type="button"
                  className="w-full text-left text-xs text-primary hover:underline disabled:text-fg-subtle disabled:no-underline disabled:cursor-not-allowed"
                  disabled={!canResend || sending}
                  onClick={resendCode}
                >
                  {!canResend
                    ? isLocked
                      ? `Resend available in ${formatCountdown(lockRemaining)}`
                      : `Send again in ${formatCountdown(resendRemaining)}`
                    : 'Didn’t get a code? Send again'}
                </button>
              </div>
              <Input
                label="New password"
                type="password"
                required
                placeholder="At least 8 characters"
                disabled={isLocked}
                {...resetForm.register('newPassword')}
                error={resetForm.formState.errors.newPassword?.message}
              />
              <Input
                label="Confirm password"
                type="password"
                required
                disabled={isLocked}
                {...resetForm.register('confirmPassword')}
                error={resetForm.formState.errors.confirmPassword?.message}
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                icon={KeyRound}
                loading={resetting}
                disabled={resetting || isLocked}
              >
                {isLocked ? `Locked — ${formatCountdown(lockRemaining)}` : 'Update password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
