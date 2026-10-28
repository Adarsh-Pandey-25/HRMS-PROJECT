import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Activity, FileText, MessageCircle, Send, BellRing } from 'lucide-react';
import {
  Card, CardHeader, Button, Badge, Input, Select, Skeleton, Tabs, EmptyState, Toggle, ConfirmDialog, PageHeader,
} from '../../components/ui';
import {
  getWhatsAppOverviewApi, listWhatsAppMessagesApi, setWhatsAppPausedApi, getWhatsAppTemplatesApi,
  syncWhatsAppTemplatesApi, sendWhatsAppTestApi, SUPER_ADMIN_WHATSAPP_API,
} from '../../api/whatsapp.api';
import { WhatsAppUpdatesCard } from '../../components/whatsapp/WhatsAppUpdatesCard';
import { formatDateTime } from '../../lib/utils';

const PAGE_SIZE = 25;

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'log', label: 'Message log', icon: MessageCircle },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'me', label: 'My alerts', icon: BellRing },
];

const STATUS_META = {
  queued: { label: 'Queued', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'info' },
  sent: { label: 'Sent', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  read: { label: 'Read', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'warning' },
};

const SKIP_REASON = {
  not_connected: 'Disconnected or replied STOP before sending',
  group_off: 'They switched this group off',
  not_on_test_allow_list: 'Not on the test number list (development)',
  unknown_template: 'Unknown template',
  duplicate: 'Already sent for this event',
};

const QUALITY_TONE = { GREEN: 'success', YELLOW: 'warning', RED: 'danger' };
const META_STATUS_TONE = {
  APPROVED: 'success', PENDING: 'warning', IN_APPEAL: 'warning', REJECTED: 'danger', PAUSED: 'danger', DISABLED: 'danger', NOT_SUBMITTED: 'neutral',
};

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Super Admin → WhatsApp: is it set up and healthy, what was sent to whom
 * (numbers masked, no message text), an estimate of Meta's bill, the pause
 * switch, template submission, and your own platform alerts.
 */
export default function SuperAdminWhatsApp() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="WhatsApp"
        subtitle="Every SpaxSync notification, also on WhatsApp — for people who connected their own number."
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview />}
      {tab === 'log' && <MessageLog />}
      {tab === 'templates' && <Templates />}
      {tab === 'me' && (
        <div className="max-w-xl">
          <WhatsAppUpdatesCard
            api={SUPER_ADMIN_WHATSAPP_API}
            queryKey={['super-admin', 'whatsapp', 'me']}
            hideWhenUnavailable={false}
            title="My platform alerts"
          />
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-fg-subtle">{label}</span>
      <span className="text-right text-fg">{children}</span>
    </div>
  );
}

function Overview() {
  const qc = useQueryClient();
  const queryKey = ['super-admin', 'whatsapp', 'overview'];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: getWhatsAppOverviewApi, staleTime: 30_000 });
  const [busy, setBusy] = useState(null);
  const [reason, setReason] = useState('');
  const [testTo, setTestTo] = useState('');

  if (isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error) return <EmptyState icon={MessageCircle} title="Could not load WhatsApp" message={error.message} />;

  const { config, state, health, connected, last30Days } = data;

  const setPaused = async (paused) => {
    setBusy('pause');
    try {
      await setWhatsAppPausedApi(paused, reason);
      await qc.invalidateQueries({ queryKey });
      toast.success(paused ? 'Sending paused' : 'Sending resumed');
      setReason('');
    } catch (err) {
      toast.error(err.message || 'Could not change');
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      const result = await sendWhatsAppTestApi(testTo);
      toast.success(`Test message sent to ${result.to}`);
    } catch (err) {
      toast.error(err.message || 'Could not send');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader
          title="Setup"
          subtitle={config.production ? 'Production server' : `Developer machine (${config.environment})`}
          action={<Badge tone={config.enabled ? 'success' : 'neutral'} dot>{config.enabled ? 'Switched on' : 'Switched off'}</Badge>}
        />
        <div className="px-5 pb-4 divide-y divide-border/50">
          <Row label="Business number">{config.businessNumber || '—'}</Row>
          <Row label="Phone number ID">{config.phoneNumberId || '—'}</Row>
          <Row label="WhatsApp Business Account ID">{config.wabaId || '—'}</Row>
          <Row label="Graph API version">{config.apiVersion}</Row>
          {!config.production && (
            <Row label="Test numbers allowed">{config.testRecipients?.length ? config.testRecipients.join(', ') : 'none — nothing is sent'}</Row>
          )}
          {config.missing?.length > 0 && (
            <div className="py-3">
              <p className="text-sm text-warning font-medium">Still missing in the server settings:</p>
              <p className="text-xs text-fg-subtle mt-1 font-mono break-all">{config.missing.join(', ')}</p>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="WhatsApp account" subtitle="As Meta reports it" />
        <div className="px-5 pb-4 divide-y divide-border/50">
          {!health && <p className="py-3 text-sm text-fg-subtle">Shown once WhatsApp is switched on with a token.</p>}
          {health?.error && <p className="py-3 text-sm text-danger">{health.error}</p>}
          {health && !health.error && (
            <>
              <Row label="Name">{health.verifiedName || '—'}</Row>
              <Row label="Number">{health.displayNumber || '—'}</Row>
              <Row label="Quality">
                {health.qualityRating ? <Badge tone={QUALITY_TONE[health.qualityRating] || 'neutral'}>{health.qualityRating}</Badge> : '—'}
              </Row>
              <Row label="Display name review">{health.nameStatus || '—'}</Row>
              <Row label="Throughput">{health.throughput || '—'}</Row>
            </>
          )}
          <Row label="Last message from Meta">{state.lastWebhookAt ? formatDateTime(state.lastWebhookAt) : 'never'}</Row>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Sending"
          subtitle="Pausing stops every WhatsApp message from this server at once; they wait in the queue."
          action={<Badge tone={state.paused ? 'danger' : 'success'} dot>{state.paused ? 'Paused' : 'Running'}</Badge>}
        />
        <div className="p-5 pt-3 space-y-3">
          {state.paused && (
            <p className="text-sm text-fg-muted">
              {state.pausedReason}{state.pausedBy ? ` — ${state.pausedBy}` : ''}{state.pausedAt ? `, ${formatDateTime(state.pausedAt)}` : ''}
            </p>
          )}
          {!state.paused && (
            <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <Toggle
            label={state.paused ? 'Resume sending' : 'Pause all sending'}
            checked={state.paused}
            disabled={busy === 'pause'}
            onChange={(next) => setPaused(next)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Send a test message"
          subtitle={config.production ? 'Goes to your own connected WhatsApp (My alerts).' : 'Only to a number on the test list.'}
        />
        <div className="p-5 pt-3 flex flex-col sm:flex-row gap-2">
          {!config.production && (
            <Input
              placeholder="Number with country code, e.g. +919876543210"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              containerClass="flex-1"
            />
          )}
          <Button icon={Send} onClick={sendTest} loading={busy === 'test'} disabled={busy === 'test' || (!config.production && !testTo.trim())}>
            Send “hello world”
          </Button>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Last 30 days"
          subtitle={`Estimated Meta bill (before GST) at India list prices of ${last30Days.rates.asOf}: utility ${inr(last30Days.rates.utility)}, marketing ${inr(last30Days.rates.marketing)} per message. Meta’s invoice is the real bill.`}
          action={<span className="text-lg font-semibold text-fg">{inr(last30Days.estimatedCostInr)}</span>}
        />
        <div className="p-5 pt-3 space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="neutral">{last30Days.total} messages</Badge>
            {Object.entries(last30Days.byStatus || {}).map(([status, count]) => (
              <Badge key={status} tone={STATUS_META[status]?.tone || 'neutral'}>{STATUS_META[status]?.label || status}: {count}</Badge>
            ))}
            <Badge tone="neutral">Charged utility: {last30Days.charged.utility}</Badge>
            <Badge tone="neutral">Charged marketing: {last30Days.charged.marketing}</Badge>
          </div>
          <p className="text-sm text-fg-muted">
            {connected.employees} employees connected · {connected.stopped} replied STOP · {connected.superAdmins} super admins get platform alerts
          </p>
          {last30Days.byCompany.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Company', 'Messages', 'Delivered', 'Failed', 'Estimated cost'].map((h) => (
                      <th key={h} className="py-2 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {last30Days.byCompany.map((c) => (
                    <tr key={c.companyId} className="border-b border-border/50">
                      <td className="py-2 pr-3"><Link to={`/super-admin/companies/${c.companyId}`} className="text-primary hover:underline">{c.companyName}</Link></td>
                      <td className="py-2 pr-3">{c.total}</td>
                      <td className="py-2 pr-3">{c.delivered}</td>
                      <td className="py-2 pr-3">{c.failed}</td>
                      <td className="py-2 pr-3">{inr(c.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function MessageLog() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['super-admin', 'whatsapp', 'messages', { status, page }],
    queryFn: () => listWhatsAppMessagesApi({ status, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const items = data?.items || [];
  const totalPages = Math.max(1, Math.ceil((data?.meta?.total || 0) / PAGE_SIZE));

  return (
    <Card>
      <CardHeader
        title="Message log"
        subtitle="Numbers are masked and message text is never stored — only the template and its short values."
        action={(
          <Select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            placeholder="All results"
            options={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))}
          />
        )}
      />
      <div className="overflow-x-auto px-5 pb-5">
        {isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
        {error && <EmptyState icon={MessageCircle} title="Could not load messages" message={error.message} />}
        {!isLoading && !error && items.length === 0 && <p className="text-sm text-fg-subtle py-8 text-center">No WhatsApp messages yet.</p>}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['When', 'Message', 'To', 'Company', 'Result'].map((h) => (
                  <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-b border-border/50 align-top">
                  <td className="py-3 pr-3 text-xs text-fg-subtle whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                  <td className="py-3 pr-3">
                    <p className="font-medium text-fg">{m.template}</p>
                    <p className="text-xs text-fg-subtle">{m.messageGroup} · {m.category}{m.eventKey ? ` · ${m.eventKey}` : ''}</p>
                    {Array.isArray(m.params) && m.params.length > 0 && (
                      <p className="text-xs text-fg-subtle mt-0.5 max-w-md truncate" title={m.params.join(' · ')}>{m.params.join(' · ')}</p>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-fg-muted whitespace-nowrap">{m.recipient}</td>
                  <td className="py-3 pr-3 text-fg-muted">{m.companyName}</td>
                  <td className="py-3 pr-3">
                    <Badge tone={STATUS_META[m.status]?.tone || 'neutral'}>{STATUS_META[m.status]?.label || m.status}</Badge>
                    {m.skipReason && <p className="text-xs text-fg-subtle mt-1">{SKIP_REASON[m.skipReason] || m.skipReason}</p>}
                    {m.errorTitle && <p className="text-xs text-danger mt-1">{m.errorCode ? `${m.errorCode}: ` : ''}{m.errorTitle}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 pt-4">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-xs text-fg-subtle">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Templates() {
  const qc = useQueryClient();
  const queryKey = ['super-admin', 'whatsapp', 'templates'];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: getWhatsAppTemplatesApi, staleTime: 30_000 });
  const [confirm, setConfirm] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try {
      const results = await syncWhatsAppTemplatesApi();
      const submitted = results.filter((r) => r.result === 'submitted').length;
      const failed = results.filter((r) => r.result === 'error' || r.result === 'not_sent');
      if (failed.length) toast.error(`${failed.length} not accepted: ${failed.map((f) => f.name).join(', ')}`);
      toast.success(submitted ? `${submitted} templates sent to Meta for review` : 'Every template is already at Meta');
      setConfirm(false);
      await qc.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(err.message || 'Could not submit templates');
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error) return <EmptyState icon={FileText} title="Could not load templates" message={error.message} />;

  // Statuses come back only when this server can reach Meta (token + account id).
  const connectedToMeta = data.templates.some((t) => t.metaStatus !== null);
  const missing = data.templates.filter((t) => t.metaStatus === 'NOT_SUBMITTED').length;

  return (
    <Card>
      <CardHeader
        title="Message templates"
        subtitle="Meta must approve each template before it can be sent. Company news and celebrations are marketing; everything else is utility."
        action={(
          <Button size="sm" icon={Send} onClick={() => setConfirm(true)} disabled={!connectedToMeta || missing === 0}>
            {missing ? `Submit ${missing} to Meta` : 'All submitted'}
          </Button>
        )}
      />
      <div className="overflow-x-auto px-5 pb-5">
        {data.remoteError && <p className="text-sm text-danger pb-3">Meta: {data.remoteError}</p>}
        {!connectedToMeta && !data.remoteError && (
          <p className="text-sm text-fg-subtle pb-3">Switch WhatsApp on with a token and account ID to see each template’s status at Meta.</p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {['Template', 'Category', 'At Meta', 'Text'].map((h) => (
                <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.templates.map((t) => (
              <tr key={t.name} className="border-b border-border/50 align-top">
                <td className="py-3 pr-3 font-mono text-xs text-fg">{t.name}</td>
                <td className="py-3 pr-3">
                  <Badge tone={t.category === 'MARKETING' ? 'warning' : 'neutral'}>{t.category.toLowerCase()}</Badge>
                  {t.metaCategory && t.metaCategory !== t.category && (
                    <p className="text-xs text-danger mt-1">Meta: {t.metaCategory.toLowerCase()}</p>
                  )}
                </td>
                <td className="py-3 pr-3">
                  {t.metaStatus ? <Badge tone={META_STATUS_TONE[t.metaStatus] || 'neutral'}>{t.metaStatus.replace('_', ' ').toLowerCase()}</Badge> : <span className="text-xs text-fg-subtle">—</span>}
                </td>
                <td className="py-3 pr-3 text-xs text-fg-muted max-w-xl">
                  {t.body}
                  {t.problems.length > 0 && <p className="text-danger mt-1">{t.problems.join('; ')}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={sync}
        title="Submit templates to Meta?"
        message="Every template Meta does not have yet is sent for review on your WhatsApp Business Account. Approval usually takes minutes to a few hours. Existing templates are not changed."
        confirmLabel="Submit"
        tone="default"
        loading={syncing}
      />
    </Card>
  );
}
