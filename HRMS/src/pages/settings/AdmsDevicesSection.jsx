import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Fingerprint, CheckCircle2, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Modal, Badge, EmptyState, Skeleton, ConfirmDialog } from '../../components/ui';
import {
  useAdmsStatus, useUpdateAdmsDevice, useAllowAdmsDeviceNewIp, useRelearnAdmsDeviceIp, useRejectAdmsDeviceNewIp,
  useDeviceIpApprovers, useSaveDeviceIpApprovers,
} from '../../hooks/useAttendance';
import { useEmployees } from '../../hooks/useEmployees';
import { useAuthStore } from '../../store/authStore';

const ONLINE_WINDOW_MS = 90_000; // device heartbeats every ~30s

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/** Ticks every second so "last seen" labels visibly count up without waiting on a data refetch. */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function relativeTime(lastSeenAt, now) {
  if (!lastSeenAt) return 'Never';
  const seconds = Math.max(0, Math.round((now - new Date(lastSeenAt).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(lastSeenAt).toLocaleString();
}

/** device = null means "add a new device"; otherwise editing an existing one (serial is then read-only). */
function DeviceModal({ open, device, onClose }) {
  const updateDevice = useUpdateAdmsDevice();
  const isNew = !device;
  const [serial, setSerial] = useState(device?.deviceSerial || '');
  const [name, setName] = useState(device?.name || '');
  const [location, setLocation] = useState(device?.location || '');
  const [watchingSerial, setWatchingSerial] = useState(null); // set after a successful *new* registration
  const now = useNow();

  // Poll fast only while actively watching a freshly-added device connect.
  const { data: watchStatus } = useAdmsStatus(Boolean(watchingSerial));
  const watchedDevice = watchingSerial ? watchStatus?.devices?.find((d) => d.deviceSerial === watchingSerial) : null;
  const connected = watchedDevice ? isOnline(watchedDevice.lastSeenAt) : false;

  const save = async () => {
    const targetSerial = (isNew ? serial : device.deviceSerial).trim();
    if (!targetSerial) return toast.error('Device serial is required');
    try {
      await updateDevice.mutateAsync({ serial: targetSerial, name, location });
      if (isNew) {
        toast.success('Device registered — watching for it to connect…');
        setWatchingSerial(targetSerial);
      } else {
        toast.success('Device updated');
        onClose();
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save device');
    }
  };

  const finish = () => {
    setWatchingSerial(null);
    setSerial('');
    setName('');
    setLocation('');
    onClose();
  };

  if (watchingSerial) {
    return (
      <Modal
        open={open}
        onClose={finish}
        title={`Device ${watchingSerial}`}
        footer={<Button onClick={finish}>Done</Button>}
      >
        <div className="flex flex-col items-center text-center py-6 gap-3">
          {connected ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="text-sm font-medium text-fg">Connected — device is live</p>
              <p className="text-xs text-fg-subtle">Last heartbeat {relativeTime(watchedDevice.lastSeenAt, now)}.</p>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-sm font-medium text-fg">Waiting for the device to check in…</p>
              <p className="text-xs text-fg-subtle max-w-xs">
                This device pushes a heartbeat roughly every 30 seconds once its server address points here.
                No action needed — this'll flip to Connected automatically. You can also close this and check
                the device's status anytime in the table.
              </p>
            </>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? 'Add Biometric Device' : `Edit Device ${device?.deviceSerial || ''}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={updateDevice.isPending}>{isNew ? 'Add Device' : 'Save'}</Button>
      </>}
    >
      <div className="space-y-4">
        {isNew ? (
          <>
            <Input label="Device serial" placeholder="e.g. NFZ8244800715" value={serial} onChange={(e) => setSerial(e.target.value)} />
            <p className="text-xs text-fg-subtle">The serial number printed on the device (any make/model works — point the device's server address at this domain and it'll start reporting under this serial).</p>
          </>
        ) : null}
        <Input label="Name" placeholder="e.g. Main Gate" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Location" placeholder="e.g. Ground Floor Reception" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
    </Modal>
  );
}

/** "20 Nov, 9:41 am" */
function shortDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** "3 punches" / "1 punch" */
const punchCount = (n) => `${n} punch${n === 1 ? '' : 'es'}`;

/**
 * The IP a device is pinned to. Punches count only from it; a request from
 * any other IP is shown here as waiting for approval. Since 20 Nov 2026 its
 * punches are kept meanwhile (`keepsPunches`) and count once it is allowed.
 */
function DeviceIpCell({ device, keepsPunches, onAllow, onReject, onRelearn }) {
  return (
    <div className="space-y-1">
      {device.allowedIp ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-fg">{device.allowedIp}</span>
          <button
            type="button"
            title="Re-learn IP"
            onClick={() => onRelearn(device)}
            className="p-1 rounded-md text-fg-subtle hover:bg-primary/10 hover:text-primary"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <span className="text-xs text-fg-subtle italic">Learns on next contact</span>
      )}
      {device.pendingIp ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="warning">New IP waiting: <span className="font-mono">{device.pendingIp}</span></Badge>
            <Button size="sm" variant="secondary" onClick={() => onAllow(device)}>Allow new IP</Button>
            {keepsPunches ? <Button size="sm" variant="ghost" onClick={() => onReject(device)}>Reject</Button> : null}
          </div>
          {keepsPunches ? (
            <p className="text-[11px] text-fg-subtle">
              {device.keptPunches
                ? `${punchCount(device.keptPunches)} kept since ${shortDateTime(device.keptSince)}. They count once you allow it.`
                : 'Its punches are kept until someone decides.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Settings → Attendance → Biometric Devices: who is asked to approve a
 * machine's new internet address (IP) — by email, and on WhatsApp with
 * Approve / Reject. Every HR and Admin by default; anyone else (e.g. the
 * tech team) can be ticked as well.
 */
function IpApproversCard({ keepsPunches }) {
  const { data, isLoading } = useDeviceIpApprovers();
  const save = useSaveDeviceIpApprovers();
  const { employees = [], isLoading: peopleLoading } = useEmployees();
  const companyId = useAuthStore((s) => s.user?.companyId || null);
  const [draft, setDraft] = useState(null);
  const [search, setSearch] = useState('');

  const stored = data || { roles: ['admin', 'hr'], employeeIds: [] };
  const value = draft || stored;
  const same = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');
  const dirty = Boolean(draft) && (!same(draft.roles, stored.roles) || !same(draft.employeeIds, stored.employeeIds));
  const nobody = !value.roles.length && !value.employeeIds.length;

  // Admins and HR are covered by the two boxes above; the list is everyone else here who is still active.
  const others = useMemo(() => employees
    .filter((e) => e.status !== 'offboarded' && e.status !== 'resigned')
    .filter((e) => !['admin', 'hr'].includes(e.role))
    .filter((e) => !companyId || !e.companyId || String(e.companyId) === String(companyId))
    .sort((a, b) => String(a.name).localeCompare(String(b.name))), [employees, companyId]);
  const q = search.trim().toLowerCase();
  const shown = q
    ? others.filter((e) => [e.name, e.department, e.designation, e.employeeCode].some((v) => String(v || '').toLowerCase().includes(q)))
    : others;

  const toggleRole = (role) => setDraft({
    ...value,
    roles: value.roles.includes(role) ? value.roles.filter((r) => r !== role) : [...value.roles, role],
  });
  const togglePerson = (id) => setDraft({
    ...value,
    employeeIds: value.employeeIds.includes(id) ? value.employeeIds.filter((x) => x !== id) : [...value.employeeIds, id],
  });

  const onSave = async () => {
    try {
      await save.mutateAsync(value);
      setDraft(null);
      toast.success('Saved who approves a new IP');
    } catch (err) {
      toast.error(err.message || 'Could not save');
    }
  };

  return (
    <Card>
      <CardHeader
        title="Who approves a new IP"
        subtitle={keepsPunches
          ? "When a machine's internet address changes (new connection, router restart), its punches are kept, not lost, until one of these people approves the new IP — on WhatsApp with the Approve button, or above with Allow new IP."
          : "When a machine's internet address changes (new connection, router restart), these people are told by email so they can allow the new IP above."}
      />
      <div className="p-5 pt-3 space-y-4">
        {isLoading ? <Skeleton className="h-16 w-full" /> : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {[['admin', 'All Admins'], ['hr', 'All HR']].map(([role, label]) => (
                <label key={role} className="inline-flex items-center gap-2 text-sm text-fg cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.roles.includes(role)} onChange={() => toggleRole(role)} />
                  {label}
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-fg">Tech team (optional)</p>
                <p className="text-xs text-fg-subtle">Tick anyone else who should get the approval on WhatsApp, such as the person who looks after your office internet.</p>
              </div>
              <Input placeholder="Search by name, department or designation" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="max-h-56 overflow-y-auto rounded-input border border-border divide-y divide-border/50">
                {peopleLoading ? (
                  <div className="p-3"><Skeleton className="h-8 w-full" /></div>
                ) : shown.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-fg-subtle">{others.length ? 'Nobody matches that search.' : 'No other employees yet.'}</p>
                ) : shown.map((e) => (
                  <label key={e.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.employeeIds.includes(e.id)} onChange={() => togglePerson(e.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{e.name}</span>
                      <span className="block truncate text-xs text-fg-subtle">{[e.designation, e.department].filter(Boolean).join(' · ') || e.employeeCode}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={`text-xs ${nobody ? 'text-danger' : 'text-fg-subtle'}`}>
                {nobody
                  ? 'Choose at least one: otherwise nobody is asked.'
                  : keepsPunches
                    ? 'Everyone chosen gets the email; those with WhatsApp connected also get the Approve / Reject message.'
                    : 'Everyone chosen gets the email.'}
              </p>
              <div className="flex items-center gap-2">
                {dirty ? <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Undo</Button> : null}
                <Button size="sm" icon={ShieldCheck} onClick={onSave} disabled={!dirty || nobody} loading={save.isPending}>Save</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function AdmsDevicesSection() {
  const { data, isLoading } = useAdmsStatus();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [allowing, setAllowing] = useState(null); // { deviceSerial, pendingIp, ... }
  const [rejecting, setRejecting] = useState(null);
  const [relearning, setRelearning] = useState(null);
  const allowNewIp = useAllowAdmsDeviceNewIp();
  const rejectNewIp = useRejectAdmsDeviceNewIp();
  const relearnIp = useRelearnAdmsDeviceIp();
  const devices = data?.devices || [];
  const keepsPunches = Boolean(data?.keepsPunches);
  const now = useNow();

  const confirmAllow = async () => {
    try {
      const result = await allowNewIp.mutateAsync({ serial: allowing.deviceSerial, ip: allowing.pendingIp });
      const kept = result?.keptPunches ? ` The ${punchCount(result.keptPunches)} kept since then are being added now.` : '';
      toast.success(`Punches from ${allowing.pendingIp} will now be accepted.${kept}`);
      setAllowing(null);
    } catch (err) {
      toast.error(err.message || 'Could not allow the new IP');
      setAllowing(null);
    }
  };

  const confirmReject = async () => {
    try {
      await rejectNewIp.mutateAsync({ serial: rejecting.deviceSerial, ip: rejecting.pendingIp });
      toast.success(`${rejecting.pendingIp} was rejected. Its punches stay kept but are not counted.`);
      setRejecting(null);
    } catch (err) {
      toast.error(err.message || 'Could not reject the new IP');
      setRejecting(null);
    }
  };

  const confirmRelearn = async () => {
    try {
      await relearnIp.mutateAsync({ serial: relearning.deviceSerial });
      toast.success('The device will be pinned to the IP of its next request');
      setRelearning(null);
    } catch (err) {
      toast.error(err.message || 'Could not reset the device IP');
    }
  };

  return (
    <>
    <Card>
      <CardHeader
        title="Biometric Devices"
        subtitle="Register your own device by serial — works for any make/model, nothing to configure in code"
        action={<div className="flex items-center gap-2">
          {data ? <Badge tone="neutral">{data.todayPunchCount} punch{data.todayPunchCount === 1 ? '' : 'es'} today</Badge> : null}
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add Device</Button>
        </div>}
      />
      <div className="p-5 pt-3 overflow-x-auto">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : devices.length === 0 ? (
          <EmptyState
            icon={Fingerprint}
            title="No devices registered yet"
            message="Add a device by its serial number — once you point that device's server address at this domain, its heartbeats and punches will show up here automatically."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Serial</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Name</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Location</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Last Seen</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Allowed IP</th>
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const online = isOnline(d.lastSeenAt);
                return (
                  <tr key={d.deviceSerial} className="border-b border-border/50">
                    <td className="py-2.5 font-mono text-xs text-fg">{d.deviceSerial}</td>
                    <td className="py-2.5 text-fg-muted">{d.name || <span className="text-fg-subtle italic">Unlabeled</span>}</td>
                    <td className="py-2.5 text-fg-muted">{d.location || '—'}</td>
                    <td className="py-2.5 text-fg-muted text-xs">{relativeTime(d.lastSeenAt, now)}</td>
                    <td className="py-2.5 pr-3">
                      <DeviceIpCell device={d} keepsPunches={keepsPunches} onAllow={setAllowing} onReject={setRejecting} onRelearn={setRelearning} />
                    </td>
                    <td className="py-2.5">
                      <Badge tone={online ? 'success' : 'neutral'}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${online ? 'bg-success animate-pulse' : 'bg-fg-subtle'}`} />
                        {online ? 'Connected' : 'Offline'}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <button type="button" onClick={() => setEditing(d)} className="p-1.5 rounded-md text-fg-subtle hover:bg-primary/10 hover:text-primary">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <DeviceModal key={editing?.deviceSerial || 'edit-none'} open={Boolean(editing)} device={editing} onClose={() => setEditing(null)} />
      <DeviceModal key={adding ? 'add-open' : 'add-closed'} open={adding} device={null} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={Boolean(allowing)}
        onClose={() => setAllowing(null)}
        onConfirm={confirmAllow}
        loading={allowNewIp.isPending}
        tone="warning"
        title="Allow this new IP?"
        message={allowing
          ? `Punches for ${allowing.name || allowing.deviceSerial} will be accepted from ${allowing.pendingIp} instead of ${allowing.allowedIp || 'its old IP'}.${allowing.keptPunches ? ` The ${punchCount(allowing.keptPunches)} kept since ${shortDateTime(allowing.keptSince)} will count too, at the times they were made.` : ''} Only allow it if your office's internet connection changed. If nothing changed, someone may be using this device's serial to send fake attendance.`
          : ''}
        confirmLabel="Allow new IP"
      />
      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={confirmReject}
        loading={rejectNewIp.isPending}
        tone="warning"
        title="Reject this new IP?"
        message={rejecting
          ? `${rejecting.name || rejecting.deviceSerial} stays allowed only from ${rejecting.allowedIp || 'its old IP'}. Punches it sends from ${rejecting.pendingIp} are kept but never counted, and nobody is asked about this IP again for 7 days. If your office's internet really changed, allow it instead — or use Re-learn IP later.`
          : ''}
        confirmLabel="Reject"
      />
      <ConfirmDialog
        open={Boolean(relearning)}
        onClose={() => setRelearning(null)}
        onConfirm={confirmRelearn}
        loading={relearnIp.isPending}
        tone="warning"
        title="Re-learn this device's IP?"
        message={relearning
          ? `${relearning.name || relearning.deviceSerial} will be pinned to whichever IP it next connects from. Use this when your office's public IP changes often, and only while the device is switched on and connected, so it is the first to connect.`
          : ''}
        confirmLabel="Re-learn IP"
      />
    </Card>
    <IpApproversCard keepsPunches={keepsPunches} />
    </>
  );
}
