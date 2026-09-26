import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Inbox, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Card, CardHeader, Button, Badge, Input, Select, Skeleton, Modal,
} from '../../components/ui';
import {
  checkInviteSlugApi, inviteFromLeadApi, listLeadsApi, updateLeadStatusApi,
} from '../../api/superAdmin.api';
import { formatDateTime } from '../../lib/utils';
import { useDebounce } from '../../hooks/useDebounce';
import { workspaceUrl } from '../../lib/host';

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'invited', label: 'Invited' },
  { value: 'rejected', label: 'Rejected' },
];
const STATUS_TONE = {
  new: 'info', contacted: 'warning', invited: 'success', rejected: 'neutral',
};
const TYPE_OPTIONS = [
  { value: 'trial', label: 'Trial requests' },
  { value: 'contact', label: 'Contact messages' },
];
const PAGE_SIZE = 20;

const slugFromName = (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';

export default function SuperAdminLeads() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [inviteLead, setInviteLead] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'leads', { status, type, page }],
    queryFn: () => listLeadsApi({ page, limit: PAGE_SIZE, status, type }),
    placeholderData: keepPreviousData,
  });
  const leads = data?.items || [];
  const total = data?.meta?.total ?? leads.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = () => qc.invalidateQueries({ queryKey: ['super-admin', 'leads'] });

  const changeStatus = async (lead, next) => {
    try {
      await updateLeadStatusApi(lead.id, next);
      toast.success('Lead updated');
      refresh();
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold text-fg flex items-center gap-2">
          <Inbox className="h-6 w-6 text-primary" /> Leads
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Free-trial requests and contact messages from spaxsync.com. Approve a trial with “Send invite” — the company gets an onboarding link by email.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Inbox"
          subtitle={isLoading ? 'Loading…' : `${total} lead${total === 1 ? '' : 's'}`}
          action={(
            <div className="flex gap-2">
              <Select placeholder="All types" options={TYPE_OPTIONS} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="h-9 w-44" />
              <Select placeholder="All statuses" options={STATUS_OPTIONS} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-40" />
            </div>
          )}
        />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : leads.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">No leads yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Received', 'Type', 'Name', 'Company', 'Status', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    expanded={expanded === lead.id}
                    onToggle={() => setExpanded(expanded === lead.id ? null : lead.id)}
                    onStatus={(next) => changeStatus(lead, next)}
                    onInvite={() => setInviteLead(lead)}
                  />
                ))}
              </tbody>
            </table>
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-fg-muted">Page {page} of {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </Card>

      {inviteLead && (
        <InviteModal
          lead={inviteLead}
          onClose={() => setInviteLead(null)}
          onSent={() => { setInviteLead(null); refresh(); }}
        />
      )}
    </div>
  );
}

function LeadRow({ lead, expanded, onToggle, onStatus, onInvite }) {
  return (
    <>
      <tr className="border-b border-border/50 cursor-pointer hover:bg-muted/30" onClick={onToggle}>
        <td className="py-3 pr-3 text-xs text-fg-subtle whitespace-nowrap">{formatDateTime(lead.createdAt)}</td>
        <td className="py-3 pr-3">
          <Badge tone={lead.type === 'trial' ? 'info' : 'neutral'}>{lead.type === 'trial' ? 'Trial' : 'Contact'}</Badge>
        </td>
        <td className="py-3 pr-3">
          <div className="font-medium text-fg">{lead.fullName}</div>
          <div className="text-xs text-fg-subtle">{lead.workEmail}</div>
        </td>
        <td className="py-3 pr-3 text-fg-muted">{lead.companyName || '—'}</td>
        <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
          <Select
            options={STATUS_OPTIONS}
            value={lead.status}
            onChange={(e) => onStatus(e.target.value)}
            className="h-8 w-32 text-xs"
            aria-label="Lead status"
          />
        </td>
        <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {lead.type === 'trial' && lead.status !== 'invited' && (
            <Button size="sm" icon={Send} onClick={onInvite}>Send invite</Button>
          )}
          {lead.status === 'invited' && <Badge tone={STATUS_TONE.invited}>Invited</Badge>}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-muted/20">
          <td colSpan={6} className="px-3 py-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-fg-subtle">Phone</dt><dd className="text-fg">{lead.phone || '—'}</dd></div>
              <div><dt className="text-xs text-fg-subtle">Company size</dt><dd className="text-fg">{lead.companySize || '—'}</dd></div>
              <div><dt className="text-xs text-fg-subtle">Desired workspace</dt><dd className="font-mono text-fg">{lead.desiredSlug || '—'}</dd></div>
              <div className="sm:col-span-3"><dt className="text-xs text-fg-subtle">Message</dt><dd className="whitespace-pre-wrap text-fg">{lead.message || '—'}</dd></div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function InviteModal({ lead, onClose, onSent }) {
  const [companyName, setCompanyName] = useState(lead.companyName || '');
  const [slug, setSlug] = useState(lead.desiredSlug || slugFromName(lead.companyName));
  const [days, setDays] = useState(7);
  const [slugStatus, setSlugStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const debouncedSlug = useDebounce(slug, 400);

  useEffect(() => {
    if (!debouncedSlug) {
      setSlugStatus(null);
      return undefined;
    }
    let cancelled = false;
    checkInviteSlugApi(debouncedSlug)
      .then((res) => { if (!cancelled) setSlugStatus(res?.status || null); })
      .catch(() => { if (!cancelled) setSlugStatus(null); });
    return () => { cancelled = true; };
  }, [debouncedSlug]);

  const blocked = ['taken', 'reserved', 'invalid'].includes(slugStatus);

  const send = async () => {
    if (companyName.trim().length < 2) {
      toast.error('Company name is required');
      return;
    }
    setSending(true);
    try {
      await inviteFromLeadApi(lead.id, {
        companyName: companyName.trim(),
        slug: slug.trim() || undefined,
        expiresInDays: Number(days) || 7,
      });
      toast.success(`Invite emailed to ${lead.workEmail}`);
      onSent();
    } catch (err) {
      toast.error(err.message || 'Could not send the invite');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Send invite to ${lead.fullName}`}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button icon={Send} onClick={send} loading={sending} disabled={sending || blocked}>Send invite</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          An onboarding link goes to <span className="font-medium text-fg">{lead.workEmail}</span>. The email and company name are locked; the workspace address can still be changed during onboarding.
        </p>
        <Input label="Company name" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <Input
          label="Workspace address"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          error={slug === debouncedSlug && blocked ? {
            taken: 'Already taken — try another',
            reserved: 'Reserved — choose another',
            invalid: 'Use lowercase letters, numbers or hyphens',
          }[slugStatus] : undefined}
          hint={workspaceUrl(slug) || 'Leave blank to auto-suggest from the company name'}
        />
        <Input label="Link valid for (days)" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
      </div>
    </Modal>
  );
}
