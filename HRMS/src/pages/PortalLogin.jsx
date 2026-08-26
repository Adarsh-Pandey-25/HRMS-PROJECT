import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input } from '../components/ui';
import { PageLoader } from '../components/layout/PageLoader';
import { useAuthStore } from '../store/authStore';
import { useCompanyStore } from '../store/companyStore';
import { fetchWorkspaceApi } from '../api/auth.api';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Shared layout for the three portal-scoped login pages (Admin / HR / Employee).
 * Structurally identical to the legacy `Login.jsx` (which stays untouched as the
 * generic/fallback login), just parameterized by `portal` + copy, and posting to
 * `/auth/{portal}/login` via `useAuthStore.login({ portal })` instead of `/auth/login`.
 *
 * Also fires `GET /auth/workspace` on mount to pick up subdomain branding once real
 * subdomains are live. Today `resolved` is always false (no wildcard DNS/TLS yet), so
 * this must — and does — fall back to today's generic branding with no loading delay:
 * the fetch never blocks first paint, it only upgrades branding if/when it resolves.
 */
export default function PortalLogin({ portal, portalLabel, placeholderEmail }) {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const company = useCompanyStore((s) => s.company);
  const [workspace, setWorkspace] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Fire-and-forget — never gate rendering on this. `resolved` is false everywhere
    // today (no wildcard DNS/TLS yet); when it later becomes true this just upgrades
    // the branding shown below, in place.
    fetchWorkspaceApi()
      .then((data) => { if (!cancelled) setWorkspace(data); })
      .catch(() => { /* stay on generic branding */ });
    return () => { cancelled = true; };
  }, []);

  const resolvedName = workspace?.resolved ? String(workspace.name || '').trim() : '';
  const genericAppName = company.name?.trim() || 'SPAXADS HRMS';
  const appName = resolvedName || genericAppName;

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

  const onSubmit = async ({ email, password }) => {
    try {
      const { user } = await login({ email, password, portal });
      if (user?.mustChangePassword) {
        toast('Set a new password to continue', { icon: '🔐' });
      } else {
        toast.success('Welcome back');
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // Backend writes both wrong-portal (403) and wrong-credentials messages to be
      // user-facing already — no special-casing needed here.
      toast.error(err.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-light via-page to-primary-light px-4 animate-fade-in">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-card-hover">
            <span className="text-white font-bold text-xl leading-none">{appName[0]?.toUpperCase() || 'H'}</span>
          </div>
          <h1 className="text-xl font-semibold text-fg">
            {resolvedName ? `Sign in to ${resolvedName}` : `Sign in to the ${portalLabel}`}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {resolvedName ? `${portalLabel} · Enter your work email and password.` : 'Enter your work email and password.'}
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label="Work email" type="email" required placeholder={placeholderEmail} {...register('email')} error={errors.email?.message} />
            <Input label="Password" type="password" required placeholder="Enter your password" {...register('password')} error={errors.password?.message} />
            <div className="flex justify-end -mt-1">
              <Link to="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" size="lg" className="w-full" icon={LogIn} loading={isLoading} disabled={isLoading}>
              Sign In
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
