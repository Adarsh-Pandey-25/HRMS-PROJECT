import { useState } from 'react';
import { Pencil, Fingerprint } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Modal, Badge, EmptyState, Skeleton } from '../../components/ui';
import { useAdmsStatus, useUpdateAdmsDevice } from '../../hooks/useAttendance';

const ONLINE_WINDOW_MS = 90_000; // device heartbeats every ~30s

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

function EditDeviceModal({ device, onClose }) {
  const updateDevice = useUpdateAdmsDevice();
  const [name, setName] = useState(device?.name || '');
  const [location, setLocation] = useState(device?.location || '');

  const save = async () => {
    try {
      await updateDevice.mutateAsync({ serial: device.deviceSerial, name, location });
      toast.success('Device updated');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to update device');
    }
  };

  return (
    <Modal
      open={Boolean(device)}
      onClose={onClose}
      title={`Label Device ${device?.deviceSerial || ''}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={updateDevice.isPending}>Save</Button>
      </>}
    >
      <div className="space-y-4">
        <Input label="Name" placeholder="e.g. Main Gate" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Location" placeholder="e.g. Ground Floor Reception" value={location} onChange={(e) => setLocation(e.target.value)} />
        <p className="text-xs text-fg-subtle">Device serial is fixed — it's read from the device's own heartbeat, not set here.</p>
      </div>
    </Modal>
  );
}

export function AdmsDevicesSection() {
  const { data, isLoading } = useAdmsStatus();
  const [editing, setEditing] = useState(null);
  const devices = data?.devices || [];

  return (
    <Card>
      <CardHeader
        title="Biometric Devices"
        subtitle="Auto-discovered from live ADMS heartbeats — nothing to add manually"
        action={data ? <Badge tone="neutral">{data.todayPunchCount} punch{data.todayPunchCount === 1 ? '' : 'es'} today</Badge> : null}
      />
      <div className="p-5 pt-3 overflow-x-auto">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : devices.length === 0 ? (
          <EmptyState
            icon={Fingerprint}
            title="No device has connected yet"
            message="Once your eSSL device pings /iclock/getrequest, it'll show up here automatically — nothing to configure by hand."
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
      <EditDeviceModal device={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}
