import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal, Button, Input } from '../ui';
import { changePasswordApi } from '../../api/auth.api';
import { useAuthStore } from '../../store/authStore';

const schema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm your password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export function ForcePasswordChangeModal() {
  const user = useAuthStore((s) => s.user);
  const pendingLoginPassword = useAuthStore((s) => s.pendingLoginPassword);
  const logout = useAuthStore((s) => s.logout);
  const clearPasswordChangeRequirement = useAuthStore((s) => s.clearPasswordChangeRequirement);
  const [submitting, setSubmitting] = useState(false);

  const open = Boolean(user?.mustChangePassword);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async ({ newPassword }) => {
    setSubmitting(true);
    try {
      await changePasswordApi({
        ...(pendingLoginPassword ? { currentPassword: pendingLoginPassword } : {}),
        newPassword,
      });
      clearPasswordChangeRequirement();
      reset();
      toast.success('Password updated. You can continue using HRMS.');
    } catch (err) {
      toast.error(err.message || 'Could not update password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
  };

  return (
    <Modal
      open={open}
      dismissible={false}
      title="Set your new password"
      subtitle="You signed in with a temporary password from your welcome email. Choose a personal password to continue."
      size="md"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            icon={LogOut}
            onClick={handleSignOut}
            disabled={submitting}
          >
            Sign out
          </Button>
          <Button
            type="submit"
            form="force-password-change-form"
            icon={KeyRound}
            loading={submitting}
          >
            Save password
          </Button>
        </>
      )}
    >
      <form id="force-password-change-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-fg-muted">
          Signed in as <span className="font-medium text-fg">{user?.workEmail || user?.email}</span>
        </p>
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <p className="text-xs text-fg-subtle">
          Use at least 8 characters with a number and a special character (for example ! @ #).
        </p>
      </form>
    </Modal>
  );
}
