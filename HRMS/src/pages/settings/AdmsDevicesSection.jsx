import { useEffect, useState } from 'react';
import { Plus, Pencil, Fingerprint, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Modal, Badge, EmptyState, Skeleton, ConfirmDialog } from '../../components/ui';
import {
  useAdmsStatus, useUpdateAdmsDevice, useAllowAdmsDeviceNewIp, useRelearnAdmsDeviceIp,
} from '../../hooks/useAttendance';

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

/**
 * The IP a device is pinned to. Punches are accepted only from it; a request
 * from any other IP is refused and shown here as waiting for approval.
 */
function DeviceIpCell({ device, onAllow, onRelearn }) {
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
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="warning">New IP waiting: <span className="font-mono">{device.pendingIp}</span></Badge>
          <Button size="sm" variant="secondary" onClick={() => onAllow(device)}>Allow new IP</Button>
        </div>
      ) : null}
    </div>
  );
}

export function AdmsDevicesSection() {
  const { data, isLoading } = useAdmsStatus();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [allowing, setAllowing] = useState(null); // { deviceSerial, pendingIp, ... }
  const [relearning, setRelearning] = useState(null);
  const allowNewIp = useAllowAdmsDeviceNewIp();
  const relearnIp = useRelearnAdmsDeviceIp();
  const devices = data?.devices || [];
  const now = useNow();

  const confirmAllow = async () => {
    try {
      await allowNewIp.mutateAsync({ serial: allowing.deviceSerial, ip: allowing.pendingIp });
      toast.success(`Punches from ${allowing.pendingIp} will now be accepted`);
      setAllowing(null);
    } catch (err) {
      toast.error(err.message || 'Could not allow the new IP');
      setAllowing(null);
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
                      <DeviceIpCell device={d} onAllow={setAllowing} onRelearn={setRelearning} />
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
          ? `Punches for ${allowing.name || allowing.deviceSerial} will be accepted from ${allowing.pendingIp} instead of ${allowing.allowedIp || 'its old IP'}. Only allow it if your office's internet connection changed. If nothing changed, someone may be using this device's serial to send fake attendance.`
          : ''}
        confirmLabel="Allow new IP"
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
  );
}
