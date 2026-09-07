import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import {
  Card, CardHeader, Button, Badge, Skeleton, PageHeader, Modal, Input, Field,
} from '../../components/ui';
import { formatDateTime } from '../../lib/utils';
import { useSuperAdminStore } from '../../store/superAdminStore';
import {
  listSuperAdminUsersApi, createSuperAdminUserApi, setSuperAdminUserActiveApi, updateSuperAdminUserRoleApi,
  startTwoFactorEnrollmentApi, confirmTwoFactorEnrollmentApi, disableTwoFactorApi,
} from '../../api/superAdmin.api';

const ROLE_LABEL = { full_admin: 'Full Admin', billing_admin: 'Billing Admin', support_admin: 'Support Admin' };

export default function AdminUsers() {
  const admin = useSuperAdminStore((s) => s.admin);
  const isFullAdmin = admin?.role === 'full_admin';

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <PageHeader title="Admin Users & Security" subtitle="Manage super-admin accounts and your own two-factor authentication." />
      <TwoFactorCard />
      {isFullAdmin ? <AdminUsersTable /> : (
        <Card>
          <CardHeader title="Team" subtitle="Only Full Admins can manage other super-admin accounts." />
          <div className="px-5 pb-5" />
        </Card>
      )}
    </div>
  );
}

function TwoFactorCard() {
  const admin = useSuperAdminStore((s) => s.admin);
  const checkSession = useSuperAdminStore((s) => s.checkSession);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollData, setEnrollData] = useState(null);
  const [code, setCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);

  const startEnroll = async () => {
    setBusy(true);
    try {
      const data = await startTwoFactorEnrollmentApi();
      setEnrollData(data);
      setEnrollOpen(true);
    } catch (err) {
      toast.error(err.message || 'Could not start enrollment');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    setBusy(true);
    try {
      await confirmTwoFactorEnrollmentApi(code);
      toast.success('Two-factor authentication enabled');
      setEnrollOpen(false);
      setCode('');
      await checkSession();
    } catch (err) {
      toast.error(err.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableTwoFactorApi(disableCode);
      toast.success('Two-factor authentication disabled');
      setDisableOpen(false);
      setDisableCode('');
      await checkSession();
    } catch (err) {
      toast.error(err.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your two-factor authentication"
        subtitle={admin?.role === 'full_admin' ? 'Strongly recommended for Full Admin accounts — the highest-privilege role in this system.' : 'Optional, but recommended.'}
        action={<Badge tone={admin?.twoFactorEnabled ? 'success' : 'warning'}>{admin?.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</Badge>}
      />
      <div className="px-5 pb-5">
        {admin?.twoFactorEnabled ? (
          <Button variant="outline" icon={ShieldOff} onClick={() => setDisableOpen(true)}>Disable 2FA</Button>
        ) : (
          <Button icon={ShieldCheck} loading={busy} onClick={startEnroll}>Set up 2FA</Button>
        )}
      </div>

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="Scan this QR code"
        subtitle="Use Google Authenticator, 1Password, or any TOTP app, then enter the 6-digit code it shows."
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={confirmEnroll}>Confirm & enable</Button>
          </div>
        )}
      >
        <div className="space-y-4">
          {enrollData?.qrDataUri && (
            <img src={enrollData.qrDataUri} alt="2FA QR code" className="mx-auto h-48 w-48 rounded-lg border border-border" />
          )}
          <p className="text-xs text-fg-subtle text-center break-all">
            Can't scan? Enter this key manually: <span className="font-mono">{enrollData?.secret}</span>
          </p>
          <Input label="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Disable two-factor authentication"
        subtitle="Enter a current code from your authenticator app to confirm."
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisableOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={disable}>Disable</Button>
          </div>
        )}
      >
        <Input label="6-digit code" inputMode="numeric" maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
      </Modal>
    </Card>
  );
}

function AdminUsersTable() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['super-admin', 'admin-users'],
    queryFn: listSuperAdminUsersApi,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'support_admin' });
  const [busy, setBusy] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['super-admin', 'admin-users'] });

  const submitCreate = async () => {
    if (!form.email || !form.password) {
      toast.error('Email and password are required');
      return;
    }
    setBusy(true);
    try {
      await createSuperAdminUserApi(form);
      toast.success('Admin user created');
      setCreateOpen(false);
      setForm({ email: '', password: '', name: '', role: 'support_admin' });
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not create admin user');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await setSuperAdminUserActiveApi(u.id, !u.isActive);
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  const changeRole = async (u, role) => {
    try {
      await updateSuperAdminUserRoleApi(u.id, role);
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  return (
    <Card>
      <CardHeader title="Team" subtitle={`${users.length} super-admin account(s)`} action={<Button size="sm" icon={UserPlus} onClick={() => setCreateOpen(true)}>Invite</Button>} />
      <div className="overflow-x-auto px-5 pb-5">
        {isLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['Email', 'Role', '2FA', 'Status', 'Last login', ''].map((h) => (
                  <th key={h || 'actions'} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-3 text-fg font-medium">{u.email}</td>
                  <td className="py-2.5 pr-3">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u, e.target.value)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-xs"
                    >
                      {Object.entries(ROLE_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                  </td>
                  <td className="py-2.5 pr-3"><Badge tone={u.twoFactorEnabled ? 'success' : 'neutral'}>{u.twoFactorEnabled ? 'On' : 'Off'}</Badge></td>
                  <td className="py-2.5 pr-3"><Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="py-2.5 pr-3 text-xs text-fg-subtle">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
                  <td className="py-2.5 text-right">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Invite a super-admin"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submitCreate}>Create</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Temporary password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          <Field label="Role">
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              {Object.entries(ROLE_LABEL).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}
