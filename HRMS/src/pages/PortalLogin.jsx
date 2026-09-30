import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  LogIn, ShieldCheck, Mail, Clock, CalendarCheck, FileText, Users, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Input } from '../components/ui';
import { AuthShell, AuthHeading, PasswordInput, CodeInput } from '../components/auth/AuthShell';
import spaxsyncMark from '../assets/brand/spaxsync-mark.svg';
import { PageLoader } from '../components/layout/PageLoader';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/** Brand-panel copy per portal. Features named here all exist in the app. */
const PORTAL_COPY = {
  employee: {
    headline: 'Your workday, all in one place.',
    subline: (company) => `Check in, apply for leave and find your payslips — everything for your day${company ? ` at ${company}` : ''}.`,
    highlights: [
      { icon: Clock, text: 'Check in from the office, your phone or the biometric device' },
      { icon: CalendarCheck, text: 'Apply for leave and follow every approval' },
      { icon: FileText, text: 'Payslips and documents whenever you need them' },
    ],
  },
  hr: {
    headline: 'Everything your people need, handled.',
    subline: (company) => `Approvals, attendance, payroll and onboarding${company ? ` for ${company}` : ''}.`,
    highlights: [
      { icon: CheckCircle2, text: 'Leave and regularization approvals in one queue' },
      { icon: Users, text: 'Onboarding, documents and employee records' },
      { icon: ShieldCheck, text: 'Every change recorded in the audit log' },
    ],
  },
  admin: {
    headline: "Run your company's HR from one place.",
    subline: (company) => `People, attendance, payroll and settings${company ? ` for ${company}` : ''}.`,
    highlights: [
      { icon: Users, text: 'Attendance, leave and payroll in one system' },
      { icon: CheckCircle2, text: 'Approvals routed to the right people' },
      { icon: ShieldCheck, text: 'Every change recorded in the audit log' },
    ],
  },
};

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

  const copy = PORTAL_COPY[portal] || PORTAL_COPY.employee;

  return (
    <AuthShell
      brandName={companyName || 'SpaxSync'}
      logoUrl={logoUrl}
      markSrc={companyName ? null : spaxsyncMark}
      headline={copy.headline}
      subline={copy.subline(companyName)}
      highlights={copy.highlights}
    >
      {twoFaToken ? (
        <form onSubmit={onSubmitCode} className="space-y-5">
          <AuthHeading
            badge={<><ShieldCheck className="h-3.5 w-3.5" /> Two-step verification</>}
            title="Enter your code"
            subtitle="Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app."
          />
          <CodeInput
            label="Authentication code"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Button type="submit" size="lg" className="w-full shadow-lg shadow-primary/25" loading={isLoading} disabled={isLoading}>
            Verify and sign in
          </Button>
          <button
            type="button"
            className="w-full text-sm text-fg-muted transition-colors hover:text-primary"
            onClick={() => { setTwoFaToken(null); setCode(''); }}
          >
            Use a different account
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <AuthHeading
            badge={portalLabel}
            title="Welcome back"
            subtitle={companyName ? `Sign in to ${companyName} with your work email.` : 'Sign in with your work email.'}
          />
          <Input
            label="Work email"
            type="email"
            icon={Mail}
            required
            autoComplete="username"
            placeholder={placeholderEmail}
            className="h-11"
            {...register('email')}
            error={errors.email?.message}
          />
          <div>
            <PasswordInput
              label="Password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              className="h-11"
              {...register('password')}
              error={errors.password?.message}
            />
            <div className="mt-2 flex justify-end">
              <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full shadow-lg shadow-primary/25" icon={LogIn} loading={isLoading} disabled={isLoading}>
            Sign in
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
