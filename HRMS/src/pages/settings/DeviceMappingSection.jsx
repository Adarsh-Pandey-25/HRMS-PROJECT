import { useState } from 'react';
import { Plus, Trash2, Fingerprint } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Select, Modal, Badge, EmptyState, Skeleton } from '../../components/ui';
import { useEmployees } from '../../hooks/useEmployees';
import { useAdmsStatus } from '../../hooks/useAttendance';
import {
  useDeviceMappings, useUnmappedPunches, useDeviceUsers, useDeviceMappingMutations,
} from '../../hooks/useDeviceMapping';

const MANUAL_ENTRY = '__manual__';

function AddMappingModal({ open, onClose }) {
  const { employees } = useEmployees();
  const { data: admsStatus } = useAdmsStatus();
  const { data: deviceUsers = [] } = useDeviceUsers();
  const devices = admsStatus?.devices || [];
  const unmappedDeviceUsers = deviceUsers.filter((d) => !d.mapped);
  const { create } = useDeviceMappingMutations();
  const [deviceUserId, setDeviceUserId] = useState('');
  const [manualId, setManualId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [deviceSerial, setDeviceSerial] = useState(devices.length === 1 ? devices[0].deviceSerial : '');

  const resolvedDeviceUserId = deviceUserId === MANUAL_ENTRY ? manualId.trim() : deviceUserId;

  const save = async () => {
    if (!resolvedDeviceUserId || !employeeId || !deviceSerial) {
      return toast.error('Device, employee, and device user ID are all required');
    }
    try {
      await create.mutateAsync({ deviceUserId: resolvedDeviceUserId, employeeId, deviceSerial });
      toast.success('Mapping created');
      setDeviceUserId('');
      setManualId('');
      setEmployeeId('');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to create mapping');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Map Device User ID to Employee"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={create.isPending}>Add Mapping</Button>
      </>}
    >
      <div className="space-y-4">
        {devices.length === 0 ? (
          <p className="text-sm text-danger">No devices registered yet — add one above first, then come back here to map employees to it.</p>
        ) : (
          <Select
            label="Device"
            value={deviceSerial}
            onChange={(e) => setDeviceSerial(e.target.value)}
            options={[{ value: '', label: 'Select device…' }, ...devices.map((d) => ({ value: d.deviceSerial, label: d.name ? `${d.name} (${d.deviceSerial})` : d.deviceSerial }))]}
          />
        )}
        <Select
          label="Employee"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          options={[{ value: '', label: 'Select employee…' }, ...employees.map((e) => ({ value: e.id, label: `${e.name} (${e.employeeCode})` }))]}
        />
        <Select
          label="Device user ID"
          value={deviceUserId}
          onChange={(e) => setDeviceUserId(e.target.value)}
          options={[
            { value: '', label: 'Select device user ID…' },
            ...unmappedDeviceUsers.map((d) => ({
              value: d.deviceUserId,
              label: `${d.deviceUserId} — ${d.punchCount} punch${d.punchCount === 1 ? '' : 'es'}, last seen ${new Date(d.lastSeen).toLocaleDateString()}`,
            })),
            { value: MANUAL_ENTRY, label: "Other (hasn't punched yet — type manually)" },
          ]}
        />
        {deviceUserId === MANUAL_ENTRY && (
          <Input
            label="Device user ID"
            type="number"
            placeholder="e.g. 5"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
          />
        )}
        {unmappedDeviceUsers.length === 0 && deviceUserId !== MANUAL_ENTRY && (
          <p className="text-xs text-fg-subtle">No unmapped device IDs have punched in yet — pick "Other" to map one by hand before its first scan.</p>
        )}
      </div>
    </Modal>
  );
}

export function DeviceMappingSection() {
  const { data: mappings = [], isLoading } = useDeviceMappings();
  const { data: unmapped = [] } = useUnmappedPunches();
  const { remove } = useDeviceMappingMutations();
  const [addOpen, setAddOpen] = useState(false);

  const handleDelete = async (deviceUserId, deviceSerial) => {
    try {
      await remove.mutateAsync({ deviceUserId, deviceSerial });
      toast.success('Mapping removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove mapping');
    }
  };

  return (
    <>
      <Card>
        <CardHeader
          title="Device → Employee Mapping"
          subtitle="Maps the fingerprint device's numeric user IDs to HRMS employees"
          action={<Button size="sm" icon={Plus} onClick={() => setAddOpen(true)}>Add Mapping</Button>}
        />
        <div className="p-5 pt-3 overflow-x-auto">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : mappings.length === 0 ? (
            <EmptyState icon={Fingerprint} title="No mappings yet" message="Add a mapping so device punches link to the right employee." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Device</th>
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Device ID</th>
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Employee</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="border-b border-border/50">
                    <td className="py-2.5 font-mono text-xs text-fg-subtle">{m.deviceSerial}</td>
                    <td className="py-2.5 font-mono text-xs text-fg">{m.deviceUserId}</td>
                    <td className="py-2.5 text-fg-muted">{m.employeeName} <span className="text-fg-subtle text-xs">({m.employeeCode})</span></td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(m.deviceUserId, m.deviceSerial)}
                        className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {unmapped.length > 0 && (
        <Card>
          <CardHeader
            title="Unmapped Punches"
            subtitle="Punches from device IDs with no employee mapping yet"
            action={<Badge tone="warning">{unmapped.length} pending</Badge>}
          />
          <div className="p-5 pt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Device ID</th>
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Punch Time</th>
                  <th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Type</th>
                </tr>
              </thead>
              <tbody>
                {unmapped.slice(0, 20).map((p) => (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="py-2.5 font-mono text-xs text-fg">{p.deviceUserId}</td>
                    <td className="py-2.5 text-fg-muted text-xs">{new Date(p.punchTime).toLocaleString()}</td>
                    <td className="py-2.5 text-fg-muted text-xs capitalize">{p.punchType?.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddMappingModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
