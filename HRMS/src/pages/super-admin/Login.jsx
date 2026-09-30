import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Shield, LogIn, KeyRound, Mail, Building2, CreditCard, Activity,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Input } from '../../components/ui';
import { AuthShell, AuthHeading, PasswordInput, CodeInput } from '../../components/auth/AuthShell';
import spaxsyncMark from '../../assets/brand/spaxsync-mark.svg';

/** Brand-panel highlights — each is a real section of this console. */
const HIGHLIGHTS = [
  { icon: Building2, text: 'Every company, its features and its email switches' },
  { icon: CreditCard, text: 'Plans, subscriptions, invoices and payments' },
  { icon: Activity, text: 'System health, the email log and the audit trail' },
];
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
    <AuthShell
      brandName="SpaxSync"
      markSrc={spaxsyncMark}
      eyebrow="Platform console"
      headline="Run the platform behind every workspace."
      subline="Companies, billing and support operations for SpaxSync, in one secure console."
      highlights={HIGHLIGHTS}
    >
      {needsTwoFactor ? (
        <form onSubmit={codeForm.handleSubmit(onSubmitCode)} className="space-y-5">
          <AuthHeading
            badge={<><KeyRound className="h-3.5 w-3.5" /> Two-step verification</>}
            title="Enter your code"
            subtitle="Open your authenticator app and enter the 6-digit code."
          />
          <CodeInput
            label="Authentication code"
            autoFocus
            error={codeForm.formState.errors.code?.message}
            {...codeForm.register('code')}
          />
          <Button type="submit" size="lg" className="w-full shadow-lg shadow-primary/25" icon={LogIn} loading={isLoading} disabled={isLoading}>
            Verify
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <AuthHeading
            badge={<><Shield className="h-3.5 w-3.5" /> Super Admin</>}
            title="Welcome back"
            subtitle="Sign in to the SpaxSync platform console."
          />
          <Input label="Email" type="email" icon={Mail} autoComplete="username" className="h-11" error={errors.email?.message} {...register('email')} />
          <PasswordInput label="Password" autoComplete="current-password" className="h-11" error={errors.password?.message} {...register('password')} />
          <Button type="submit" size="lg" className="w-full shadow-lg shadow-primary/25" icon={LogIn} loading={isLoading} disabled={isLoading}>
            Sign in
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
