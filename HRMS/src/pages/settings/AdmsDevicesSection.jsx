import { useState } from 'react';
import { Plus, Pencil, Fingerprint } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Modal, Badge, EmptyState, Skeleton } from '../../components/ui';
import { useAdmsStatus, useUpdateAdmsDevice } from '../../hooks/useAttendance';

const ONLINE_WINDOW_MS = 90_000; // device heartbeats every ~30s

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/** device = null means "add a new device"; otherwise editing an existing one (serial is then read-only). */
function DeviceModal({ open, device, onClose }) {
  const updateDevice = useUpdateAdmsDevice();
  const isNew = !device;
  const [serial, setSerial] = useState(device?.deviceSerial || '');
  const [name, setName] = useState(device?.name || '');
  const [location, setLocation] = useState(device?.location || '');

  const save = async () => {
    const targetSerial = (isNew ? serial : device.deviceSerial).trim();
    if (!targetSerial) return toast.error('Device serial is required');
    try {
      await updateDevice.mutateAsync({ serial: targetSerial, name, location });
      toast.success(isNew ? 'Device registered' : 'Device updated');
      setSerial('');
      setName('');
      setLocation('');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to save device');
    }
  };

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

export function AdmsDevicesSection() {
  const { data, isLoading } = useAdmsStatus();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const devices = data?.devices || [];

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
                <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.deviceSerial} className="border-b border-border/50">
                  <td className="py-2.5 font-mono text-xs text-fg">{d.deviceSerial}</td>
                  <td className="py-2.5 text-fg-muted">{d.name || <span className="text-fg-subtle italic">Unlabeled</span>}</td>
                  <td className="py-2.5 text-fg-muted">{d.location || '—'}</td>
                  <td className="py-2.5 text-fg-muted text-xs">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</td>
                  <td className="py-2.5"><Badge tone={isOnline(d.lastSeenAt) ? 'success' : 'neutral'}>{isOnline(d.lastSeenAt) ? 'Online' : 'Offline'}</Badge></td>
                  <td className="py-2.5 text-right">
                    <button type="button" onClick={() => setEditing(d)} className="p-1.5 rounded-md text-fg-subtle hover:bg-primary/10 hover:text-primary">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <DeviceModal key={editing?.deviceSerial || 'edit-none'} open={Boolean(editing)} device={editing} onClose={() => setEditing(null)} />
      <DeviceModal key={adding ? 'add-open' : 'add-closed'} open={adding} device={null} onClose={() => setAdding(false)} />
    </Card>
  );
}
