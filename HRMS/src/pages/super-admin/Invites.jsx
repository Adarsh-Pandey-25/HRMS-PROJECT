import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Plus, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Badge, Input, Skeleton, Modal, ConfirmDialog } from '../../components/ui';
import { createInviteApi, listInvitesApi, revokeInviteApi } from '../../api/superAdmin.api';
import { formatDateTime } from '../../lib/utils';

const STATUS_TONE = {
  active: 'success',
  used: 'info',
  expired: 'warning',
  revoked: 'neutral',
};

export default function SuperAdminInvites() {
  const qc = useQueryClient();
  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['super-admin', 'invites'],
    queryFn: listInvitesApi,
  });
  const [modal, setModal] = useState(false);
  const [email, setEmail] = useState('');
  const [hint, setHint] = useState('');
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [lastLink, setLastLink] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);

  const confirmRevoke = async () => {
    const id = revokeTarget;
    if (!id) return;
    setRevoking(id);
    try {
      await revokeInviteApi(id);
      toast.success('Invite revoked');
      await qc.invalidateQueries({ queryKey: ['super-admin', 'invites'] });
    } catch (err) {
      toast.error(err.message || 'Revoke failed');
    } finally {
      setRevoking(null);
      setRevokeTarget(null);
    }
  };

  const create = async () => {
    const lockedEmail = email.trim();
    const lockedCompanyName = hint.trim();
    if (!lockedEmail) return toast.error('Admin email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lockedEmail)) {
      return toast.error('Enter a valid admin email');
    }
    if (!lockedCompanyName) return toast.error('Company name is required');

    setCreating(true);
    try {
      const result = await createInviteApi({
        email: lockedEmail,
        companyNameHint: lockedCompanyName,
        expiresInDays: Number(days) || 7,
      });
      setLastLink(result.inviteUrl || result.invite_url);
      setEmail('');
      setHint('');
      toast.success('Invite link created — copy it now');
      await qc.invalidateQueries({ queryKey: ['super-admin', 'invites'] });
      setModal(false);
    } catch (err) {
      toast.error(err.message || 'Could not create invite');
    } finally {
      setCreating(false);
    }
  };

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const revoke = (id) => setRevokeTarget(id);

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg flex items-center gap-2">
            <Link2 className="h-6 w-6 text-primary" /> Onboarding links
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            One-time links. Company onboarding only works with a valid invite.
          </p>
        </div>
        <Button icon={Plus} onClick={() => setModal(true)}>Generate link</Button>
      </div>

      {lastLink && (
        <Card className="p-5 border-primary/30 bg-primary/5">
          <p className="text-sm font-semibold text-fg mb-2">New invite link (shown once)</p>
          <code className="block text-xs font-mono break-all text-fg bg-card rounded-md p-3 border border-border">
            {lastLink}
          </code>
          <div className="mt-3 flex gap-2">
            <Button size="sm" icon={Copy} onClick={() => copy(lastLink)}>Copy link</Button>
            <Button size="sm" variant="outline" onClick={() => setLastLink(null)}>Dismiss</Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Recent invites" subtitle={isLoading ? 'Loading…' : `${invites.length} shown`} />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : invites.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">No invites yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Status', 'Admin email', 'Company name', 'Expires', 'Created', ''].map((h) => (
                    <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-border/50">
                    <td className="py-3 pr-3">
                      <Badge tone={STATUS_TONE[inv.status] || 'neutral'}>{inv.status}</Badge>
                    </td>
                    <td className="py-3 pr-3 text-fg-muted">{inv.email || '— any —'}</td>
                    <td className="py-3 pr-3 text-fg">{inv.companyNameHint || inv.company_name_hint || '—'}</td>
                    <td className="py-3 pr-3 text-xs text-fg-subtle">{formatDateTime(inv.expiresAt || inv.expires_at)}</td>
                    <td className="py-3 pr-3 text-xs text-fg-subtle">{formatDateTime(inv.createdAt || inv.created_at)}</td>
                    <td className="py-3 text-right">
                      {inv.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          icon={Ban}
                          className="text-danger"
                          loading={revoking === inv.id}
                          onClick={() => revoke(inv.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Generate onboarding link"
        footer={(
          <>
            <Button variant="outline" onClick={() => setModal(false)}>Cancel</Button>
            <Button
              onClick={create}
              loading={creating}
              disabled={creating || !email.trim() || !hint.trim()}
            >
              Create link
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Input
            label="Admin email"
            type="email"
            required
            placeholder="admin@newcompany.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="Locked during onboarding and cannot be changed"
          />
          <Input
            label="Company name"
            required
            placeholder="Acme Corp"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            hint="Locked during onboarding and cannot be changed"
          />
          <Input
            label="Expires in (days)"
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        title="Revoke invite?"
        message="This invite link will be permanently deactivated. Anyone with the link will no longer be able to onboard."
        confirmLabel="Revoke"
        tone="danger"
        loading={Boolean(revoking)}
      />
    </div>
  );
}
