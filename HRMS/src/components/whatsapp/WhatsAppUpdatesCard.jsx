import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MessageCircle, Unplug, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, Button, Badge, Toggle, ConfirmDialog, Input } from '../ui';
import { formatDate } from '../../lib/utils';

const STATUS_BADGE = {
  connected: { label: 'Connected', tone: 'success' },
  opted_out: { label: 'Stopped', tone: 'warning' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
};

/**
 * Approve / Reject buttons on WhatsApp only reach a number the person
 * confirmed (owner's rule, 23 Nov 2026): connected with JOIN, or confirmed
 * here with a 6-digit code SpaxSync sends to it on WhatsApp. A number HR typed
 * in gets approvals without buttons until then.
 */
function ConfirmNumber({ api, waitingUntil, onConfirmed }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [sentUntil, setSentUntil] = useState(waitingUntil || null);
  const waiting = Boolean(sentUntil && new Date(sentUntil) > new Date());

  const send = async () => {
    setBusy('send');
    try {
      const result = await api.sendCode();
      if (result?.alreadyConfirmed) {
        toast.success('Your number is already confirmed');
        onConfirmed();
      } else {
        setSentUntil(result?.expiresAt || null);
        toast.success('Code sent on WhatsApp');
      }
    } catch (err) {
      toast.error(err.message || 'Could not send the code');
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    setBusy('confirm');
    try {
      await api.confirm(code);
      setCode('');
      toast.success('Number confirmed. Approvals now come with Approve / Reject buttons.');
      onConfirmed();
    } catch (err) {
      toast.error(err.message || 'Could not confirm the number');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
      <p className="text-sm font-medium text-fg">Confirm this number to approve on WhatsApp</p>
      <p className="text-xs text-fg-subtle">
        Approval requests reach you on WhatsApp without Approve / Reject buttons until you confirm this number is yours.
        We send a 6-digit code to it on WhatsApp; type it in here. Anyone else can't use it, so never share it.
      </p>
      {waiting ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Code from WhatsApp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            containerClass="w-40"
          />
          <Button size="sm" onClick={confirm} loading={busy === 'confirm'} disabled={code.length !== 6 || Boolean(busy)}>Confirm</Button>
          <Button size="sm" variant="ghost" onClick={send} disabled={Boolean(busy)}>Send a new code</Button>
        </div>
      ) : (
        <Button size="sm" icon={ShieldCheck} onClick={send} loading={busy === 'send'} disabled={Boolean(busy)}>Send code on WhatsApp</Button>
      )}
    </div>
  );
}

/**
 * "WhatsApp updates": connect your own WhatsApp (one tap — WhatsApp opens
 * with a JOIN code typed in), choose which updates you get, or disconnect.
 * Only the person can connect their own WhatsApp.
 *
 * With `hideWhenUnavailable` (the profile page) the card renders nothing
 * unless WhatsApp is available for the company or the person already
 * connected — companies without the add-on see no change at all.
 *
 * `api` = { get, start, updateGroups, disconnect } (see whatsapp.api.js), plus
 * { sendCode, confirm } where approvals apply (an employee's own profile).
 */
export function WhatsAppUpdatesCard({ api, queryKey, hideWhenUnavailable = true, title = 'WhatsApp updates' }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const waiting = Boolean(pending && new Date(pending.expiresAt) > new Date());
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: api.get,
    staleTime: 30_000,
    retry: false,
    // While we wait for the person to press Send in WhatsApp, check every few seconds.
    refetchInterval: waiting ? 4000 : false,
  });

  useEffect(() => {
    if (pending && data?.connected) {
      setPending(null);
      toast.success('WhatsApp connected');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.connected]);

  if (isLoading || isError || !data) return null;
  const status = data.connected ? 'connected' : data.status;
  if (hideWhenUnavailable && data.available === false && status === 'not_connected') return null;

  const refresh = () => qc.invalidateQueries({ queryKey });
  const canConnect = data.available !== false;

  const connect = async () => {
    setBusy('connect');
    try {
      // The person opens WhatsApp with the next tap — browsers block a window
      // opened after waiting for the server.
      setPending(await api.start());
    } catch (err) {
      toast.error(err.message || 'Could not start connecting');
    } finally {
      setBusy(null);
    }
  };

  const setGroup = async (key, enabled) => {
    setBusy(key);
    try {
      await api.updateGroups({ [key]: enabled });
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.disconnect();
      setConfirmDisconnect(false);
      await refresh();
      toast.success('WhatsApp disconnected');
    } catch (err) {
      toast.error(err.message || 'Could not disconnect');
    } finally {
      setBusy(null);
    }
  };

  const badge = STATUS_BADGE[status] || STATUS_BADGE.not_connected;

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle="Get your SpaxSync updates on WhatsApp"
        action={<Badge tone={badge.tone} dot>{badge.label}</Badge>}
      />
      <div className="p-5 pt-3 space-y-4">
        {status === 'connected' && (
          <>
            <p className="text-sm text-fg-muted">
              Connected to <span className="font-medium text-fg">{data.number}</span>
              {data.connectedAt ? ` since ${formatDate(data.connectedAt)}` : ''}. Reply STOP on WhatsApp at any time to stop.
            </p>
            {api.sendCode && data.confirmedForApprovals === false && (
              <ConfirmNumber api={api} waitingUntil={data.codeWaitingUntil} onConfirmed={refresh} />
            )}
            {api.sendCode && data.confirmedForApprovals === true && (
              <p className="inline-flex items-center gap-1.5 text-xs text-success">
                <ShieldCheck className="h-3.5 w-3.5" /> Number confirmed: approvals come with Approve / Reject buttons.
              </p>
            )}
            {data.groups?.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">What you get</p>
                {data.groups.map((g) => (
                  <Toggle
                    key={g.key}
                    label={g.label}
                    hint={g.lockedByCompany ? 'Switched off by your company' : g.description}
                    checked={g.enabled && !g.lockedByCompany}
                    disabled={Boolean(busy) || g.lockedByCompany}
                    onChange={(next) => setGroup(g.key, next)}
                  />
                ))}
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              icon={Unplug}
              onClick={() => setConfirmDisconnect(true)}
              disabled={Boolean(busy)}
            >
              Disconnect WhatsApp
            </Button>
          </>
        )}

        {status !== 'connected' && waiting && (
          <div className="space-y-3">
            <p className="text-sm text-fg">
              Tap <span className="font-medium">Open WhatsApp</span>, then <span className="font-medium">press Send</span> on the
              message that is already typed in. This page updates by itself.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={MessageCircle} onClick={() => window.open(pending.link, '_blank', 'noopener,noreferrer')}>
                Open WhatsApp
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-fg-subtle">
              On another phone? Send <span className="font-mono font-medium text-fg">{pending.message}</span> to{' '}
              <span className="font-medium text-fg">{pending.businessNumber}</span> on WhatsApp. The code works for 15 minutes.
            </p>
          </div>
        )}

        {status !== 'connected' && !waiting && (
          <div className="space-y-3">
            {status === 'opted_out' ? (
              <p className="text-sm text-fg-muted">
                You replied STOP, so WhatsApp updates are off. Reply START on WhatsApp to turn them back on, or connect again below.
              </p>
            ) : (
              <p className="text-sm text-fg-muted">
                Leave approvals, payslips, attendance alerts and company news — on WhatsApp as well as by email.
              </p>
            )}
            {canConnect ? (
              <>
                <p className="text-xs text-fg-subtle rounded-lg bg-muted/50 p-3">
                  By connecting, you agree to receive HR updates on WhatsApp, sent by SpaxSync through Meta.
                  You can stop at any time by replying STOP or switching it off here. Salary amounts and passwords are never sent on WhatsApp; the only code is the one that confirms your number.
                </p>
                <Button icon={MessageCircle} onClick={connect} loading={busy === 'connect'} disabled={Boolean(busy)}>
                  Connect WhatsApp
                </Button>
              </>
            ) : (
              data.message && <p className="text-sm text-fg-subtle">{data.message}</p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={disconnect}
        title="Disconnect WhatsApp?"
        message="You will stop getting SpaxSync updates on WhatsApp. You can connect again at any time."
        confirmLabel="Disconnect"
        loading={busy === 'disconnect'}
      />
    </Card>
  );
}
