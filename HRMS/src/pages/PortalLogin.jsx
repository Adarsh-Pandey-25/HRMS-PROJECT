import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input } from '../components/ui';
import { PageLoader } from '../components/layout/PageLoader';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Shared layout for the three company login pages on {slug}.spaxsync.com:
 * / (employees), /admin and /hr. Each posts to its own /auth/{portal}/login,
 * which enforces the role and the company server-side. Company name and
 * logo come from the workspace resolved from the subdomain.
 */
export default function PortalLogin({ portal, portalLabel, placeholderEmail }) {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const completeTwoFactor = useAuthStore((s) => s.completeTwoFactor);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const [twoFaToken, setTwoFaToken] = useState(null);
  const [code, setCode] = useState('');

  const companyName = String(workspace?.name || '').trim();
  const logoUrl = workspace?.logoUrl || null;

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (sessionChecked && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [sessionChecked, isAuthenticated, navigate]);

  if (!sessionChecked || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  const finish = (user) => {
    if (user?.mustChangePassword) {
      toast('Set a new password to continue', { icon: '🔐' });
    } else {
      toast.success('Welcome back');
    }
    navigate('/dashboard', { replace: true });
  };

  const onSubmit = async ({ email, password }) => {
    try {
      const result = await login({ email, password, portal });
      if (result.requires2FA) {
        setTwoFaToken(result.twoFaToken);
        return;
      }
      finish(result.user);
    } catch (err) {
      toast.error(err.message || 'Login failed');
    }
  };

  const onSubmitCode = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      toast.error('Enter the 6-digit code from your authenticator app');
      return;
    }
    try {
      const { user } = await completeTwoFactor({ twoFaToken, code });
      finish(user);
    } catch (err) {
      toast.error(err.message || 'Invalid code');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4 animate-fade-in">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${companyName} logo`}
              className="mx-auto mb-4 h-14 max-w-[180px] object-contain"
            />
          ) : (
            <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-card">
              <span className="text-on-primary font-bold text-xl leading-none">
                {(companyName[0] || 'S').toUpperCase()}
              </span>
            </div>
          )}
          <h1 className="text-xl font-semibold text-fg">
            {companyName ? `Sign in to ${companyName}` : `Sign in to the ${portalLabel}`}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {companyName ? `${portalLabel} · Enter your work email and password.` : 'Enter your work email and password.'}
          </p>
        </div>

        <Card className="p-6">
          {twoFaToken ? (
            <form onSubmit={onSubmitCode} className="space-y-4">
              <div className="flex items-start gap-3 text-sm text-fg-muted">
                <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p>Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app.</p>
              </div>
              <Input
                label="Authentication code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <Button type="submit" size="lg" className="w-full" loading={isLoading} disabled={isLoading}>
                Verify and sign in
              </Button>
              <button
                type="button"
                className="w-full text-xs text-fg-muted hover:text-primary"
                onClick={() => { setTwoFaToken(null); setCode(''); }}
              >
                Use a different account
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input label="Work email" type="email" required autoComplete="username" placeholder={placeholderEmail} {...register('email')} error={errors.email?.message} />
              <Input label="Password" type="password" required autoComplete="current-password" placeholder="Enter your password" {...register('password')} error={errors.password?.message} />
              <div className="flex justify-end -mt-1">
                <Link to="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" size="lg" className="w-full" icon={LogIn} loading={isLoading} disabled={isLoading}>
                Sign In
              </Button>
            </form>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-fg-subtle">
          Powered by <a href="https://spaxsync.com" className="font-medium text-fg-muted hover:text-primary">SpaxSync</a>
        </p>
      </div>
    </div>
  );
}
