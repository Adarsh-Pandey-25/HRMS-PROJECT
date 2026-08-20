import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input } from '../components/ui';
import { PageLoader } from '../components/layout/PageLoader';
import { useAuthStore } from '../store/authStore';
import { useCompanyStore } from '../store/companyStore';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const company = useCompanyStore((s) => s.company);
  const justOnboarded = Boolean(location.state?.justOnboarded);
  const onboardEmail = justOnboarded ? (location.state?.email || '') : '';
  const appName = (justOnboarded ? location.state?.companyName : null)
    || company.name?.trim()
    || 'SPAXADS HRMS';

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      email: onboardEmail,
      password: '',
    },
  });

  useEffect(() => {
    if (!justOnboarded) return;
    reset({
      email: location.state?.email || '',
      password: '',
    });
  }, [justOnboarded, location.state?.email, reset]);

  useEffect(() => {
    // After a fresh workspace launch we must not keep the previous session.
    if (justOnboarded && isAuthenticated) {
      useAuthStore.getState().logout({ silent: true });
      return;
    }
    if (sessionChecked && isAuthenticated && !justOnboarded) {
      navigate('/dashboard', { replace: true });
    }
  }, [sessionChecked, isAuthenticated, navigate, justOnboarded]);

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  if (isAuthenticated && !justOnboarded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  const onSubmit = async ({ email, password }) => {
    try {
      const { user } = await login({ email, password });
      if (user?.mustChangePassword) {
        toast('Set a new password to continue', { icon: '🔐' });
      } else {
        toast.success('Welcome back');
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
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
          <h1 className="text-xl font-semibold text-fg">Sign in to {appName}</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {justOnboarded
              ? 'Your workspace is ready. Check your email for the temporary password, then sign in.'
              : 'Enter your work email and password.'}
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label="Work email" type="email" required placeholder="e.g. admin@company.com" {...register('email')} error={errors.email?.message} />
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
