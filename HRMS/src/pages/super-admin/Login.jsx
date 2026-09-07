import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, LogIn, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input } from '../../components/ui';
import { PageLoader } from '../../components/layout/PageLoader';
import { useSuperAdminStore } from '../../store/superAdminStore';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const codeSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code'),
});

export default function SuperAdminLogin() {
  const navigate = useNavigate();
  const sessionChecked = useSuperAdminStore((s) => s.sessionChecked);
  const isAuthenticated = useSuperAdminStore((s) => s.isAuthenticated);
  const isLoading = useSuperAdminStore((s) => s.isLoading);
  const login = useSuperAdminStore((s) => s.login);
  const verifyTwoFactor = useSuperAdminStore((s) => s.verifyTwoFactor);
  const checkSession = useSuperAdminStore((s) => s.checkSession);
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  const codeForm = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

  useEffect(() => {
    if (!sessionChecked) checkSession();
  }, [sessionChecked, checkSession]);

  useEffect(() => {
    if (sessionChecked && isAuthenticated) {
      navigate('/super-admin/dashboard', { replace: true });
    }
  }, [sessionChecked, isAuthenticated, navigate]);

  if (!sessionChecked || (sessionChecked && isAuthenticated)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  const onSubmit = async ({ email, password }) => {
    try {
      const result = await login({ email, password });
      if (result?.twoFactorRequired) {
        setNeedsTwoFactor(true);
        return;
      }
      toast.success('Welcome, Super Admin');
      navigate('/super-admin/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login failed');
    }
  };

  const onSubmitCode = async ({ code }) => {
    try {
      await verifyTwoFactor(code);
      toast.success('Welcome, Super Admin');
      navigate('/super-admin/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Invalid code');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
            {needsTwoFactor ? <KeyRound className="h-6 w-6" /> : <Shield className="h-6 w-6" />}
          </div>
          <h1 className="text-xl font-semibold text-fg">{needsTwoFactor ? 'Enter your code' : 'Super Admin'}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {needsTwoFactor
              ? 'Open your authenticator app and enter the 6-digit code'
              : 'Platform control — companies, billing, and support operations'}
          </p>
        </div>
        {needsTwoFactor ? (
          <form onSubmit={codeForm.handleSubmit(onSubmitCode)} className="space-y-4">
            <Input
              label="Authentication code"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              error={codeForm.formState.errors.code?.message}
              {...codeForm.register('code')}
            />
            <Button type="submit" className="w-full" icon={LogIn} loading={isLoading} disabled={isLoading}>
              Verify
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label="Email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
            <Input label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
            <Button type="submit" className="w-full" icon={LogIn} loading={isLoading} disabled={isLoading}>
              Sign in
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
