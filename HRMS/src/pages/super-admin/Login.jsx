import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Shield, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, Button, Input } from '../../components/ui';
import { PageLoader } from '../../components/layout/PageLoader';
import { useSuperAdminStore } from '../../store/superAdminStore';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function SuperAdminLogin() {
  const navigate = useNavigate();
  const sessionChecked = useSuperAdminStore((s) => s.sessionChecked);
  const isAuthenticated = useSuperAdminStore((s) => s.isAuthenticated);
  const isLoading = useSuperAdminStore((s) => s.isLoading);
  const login = useSuperAdminStore((s) => s.login);
  const checkSession = useSuperAdminStore((s) => s.checkSession);

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    if (!sessionChecked) checkSession();
  }, [sessionChecked, checkSession]);

  useEffect(() => {
    if (sessionChecked && isAuthenticated) {
      navigate('/super-admin/companies', { replace: true });
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
      await login({ email, password });
      toast.success('Welcome, Super Admin');
      navigate('/super-admin/companies', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
            <Shield className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-fg">Super Admin</h1>
          <p className="mt-1 text-sm text-fg-muted">Platform control — companies & onboarding invites</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label="Email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
          <Input label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
          <Button type="submit" className="w-full" icon={LogIn} loading={isLoading} disabled={isLoading}>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
