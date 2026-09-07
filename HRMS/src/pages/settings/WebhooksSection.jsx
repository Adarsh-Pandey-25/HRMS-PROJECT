import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, ScrollText, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Modal, Badge, Toggle } from '../../components/ui';
import {
  fetchWebhookCatalogApi, listWebhooksApi, createWebhookApi, updateWebhookApi, deleteWebhookApi,
  listWebhookDeliveriesApi, sendTestWebhookEventApi,
} from '../../api/webhooks.api';
import { formatDateTime } from '../../lib/utils';
import { invalidateAndRefetch } from '../../lib/queryCache';

function CreateWebhookModal({ open, onClose, catalog, onCreated }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState(null);

  const toggleEvent = (key) => setEvents((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));

  const save = async () => {
    if (!url.trim()) return toast.error('Webhook URL is required');
    if (!events.length) return toast.error('Select at least one event');
    setSaving(true);
    try {
      const created = await createWebhookApi(url.trim(), events);
      setRevealed(created);
      onCreated();
    } catch (err) {
      toast.error(err.message || 'Could not create webhook');
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    setRevealed(null);
    setUrl('');
    setEvents([]);
    onClose();
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(revealed.secret);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy — select and copy manually');
    }
  };

  if (revealed) {
    return (
      <Modal open={open} onClose={finish} title="Webhook created" footer={<Button onClick={finish}>Done</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Copy this signing secret now — it will not be shown again. Use it to verify the
            <code className="mx-1 text-xs">X-Webhook-Signature</code> header on every delivery.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 block text-xs font-mono break-all text-fg bg-surface-2 rounded-md p-3 border border-border">
              {revealed.secret}
            </code>
            <Button size="sm" icon={Copy} onClick={copySecret}>Copy</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="New Webhook" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Create Webhook</Button></>}>
      <div className="space-y-4">
        <Input label="Endpoint URL" placeholder="https://example.com/hooks/hrms" value={url} onChange={(e) => setUrl(e.target.value)} hint="Must be https:// and reachable from the public internet." />
        <div>
          <p className="text-xs font-medium text-fg-muted mb-2">Subscribed events</p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {catalog.map((e) => (
              <label key={e.key} className="flex items-center gap-2.5 text-sm text-fg cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={events.includes(e.key)} onChange={() => toggleEvent(e.key)} />
                {e.label}
                <span className="text-xs text-fg-subtle font-mono">{e.key}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeliveryLogModal({ webhook, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['webhooks', webhook?.id, 'deliveries'],
    queryFn: () => listWebhookDeliveriesApi(webhook.id, { page: 1, limit: 20 }),
    enabled: Boolean(webhook),
  });
  const deliveries = data?.items || [];

  return (
    <Modal open={Boolean(webhook)} onClose={onClose} title={`Delivery Log — ${webhook?.url || ''}`} footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-fg-subtle py-4">Loading…</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-fg-subtle py-4">No deliveries yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Event</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Attempt</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Status</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Response</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">When</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-b border-border/50">
                  <td className="py-2 font-mono text-xs text-fg">{d.eventType}</td>
                  <td className="py-2 text-fg-muted text-xs">#{d.attemptNumber}</td>
                  <td className="py-2">
                    <Badge tone={d.status === 'success' ? 'success' : d.status === 'failed' ? 'danger' : 'warning'}>{d.status}</Badge>
                  </td>
                  <td className="py-2 text-fg-muted text-xs">{d.responseStatus ?? '—'}</td>
                  <td className="py-2 text-fg-subtle text-xs">{formatDateTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

export function WebhooksSection() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const [testingId, setTestingId] = useState(null);

  const { data: catalog = [] } = useQuery({ queryKey: ['webhooks', 'catalog'], queryFn: fetchWebhookCatalogApi });
  const { data: webhooks = [], isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: listWebhooksApi });

  const refresh = () => invalidateAndRefetch(qc, ['webhooks']);

  const toggleActive = async (webhook, isActive) => {
    try {
      await updateWebhookApi(webhook.id, { isActive });
      toast.success(isActive ? 'Webhook enabled' : 'Webhook disabled');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Could not update webhook');
    }
  };

  const removeWebhook = async (id) => {
    try {
      await deleteWebhookApi(id);
      toast.success('Webhook deleted');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Could not delete webhook');
    }
  };

  const sendTest = async (id) => {
    setTestingId(id);
    try {
      const result = await sendTestWebhookEventApi(id);
      if (result.ok) toast.success(`Test event delivered (HTTP ${result.status})`);
      else toast.error(`Test event failed${result.status ? ` (HTTP ${result.status})` : ''} — check the delivery log`);
    } catch (err) {
      toast.error(err.message || 'Could not send test event');
    } finally {
      setTestingId(null);
    }
  };

  const labelFor = (key) => catalog.find((e) => e.key === key)?.label || key;

  return (
    <Card>
      <CardHeader
        title="Webhooks"
        subtitle="Real-time HTTP notifications for events in your account, signed with a per-webhook secret."
        action={<Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>New Webhook</Button>}
      />
      <div className="p-5 pt-3 space-y-3">
        {isLoading ? (
          <p className="text-sm text-fg-subtle">Loading…</p>
        ) : webhooks.length === 0 ? (
          <p className="text-sm text-fg-subtle">No webhooks configured yet. Create one to get notified about events like leave approvals or new hires.</p>
        ) : (
          <ul className="space-y-3">
            {webhooks.map((w) => (
              <li key={w.id} className="rounded-xl border border-border/60 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-fg truncate">{w.url}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {w.subscribedEvents.map((e) => <Badge key={e} tone="neutral" className="text-[10px]">{labelFor(e)}</Badge>)}
                    </div>
                  </div>
                  <Toggle checked={w.isActive} onChange={(v) => toggleActive(w, v)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" icon={Send} loading={testingId === w.id} onClick={() => sendTest(w.id)}>Send Test Event</Button>
                  <Button size="sm" variant="outline" icon={ScrollText} onClick={() => setLogTarget(w)}>Delivery Log</Button>
                  <Button size="sm" variant="outline" icon={Trash2} className="text-danger" onClick={() => removeWebhook(w.id)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateWebhookModal open={createOpen} onClose={() => setCreateOpen(false)} catalog={catalog} onCreated={refresh} />
      <DeliveryLogModal webhook={logTarget} onClose={() => setLogTarget(null)} />
    </Card>
  );
}
