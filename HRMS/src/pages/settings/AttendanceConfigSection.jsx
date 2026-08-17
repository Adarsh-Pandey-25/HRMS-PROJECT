import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RefreshCw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Toggle, Badge, Modal } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateSettingApi } from '../../api/settings.api';
import { invalidateAndRefetch } from '../../lib/queryCache';

const METHOD_LABELS = {
  web: ['Web Check-in', 'Browser on desktop or phone'],
  app: ['App Check-in', 'Not used — phone uses Web Check-in'],
  biometric: ['Biometric Device', 'Physical device pushes via webhook'],
  ipWeb: ['IP-based Web', 'Office employees must check in from whitelisted IP'],
  ipApp: ['IP-based App', 'Unused — phone uses IP-based Web'],
};

function AddIpModal({ open, onClose }) {
  const addIpWhitelist = useSettingsStore((s) => s.addIpWhitelist);
  const [form, setForm] = useState({ ip: '', label: '' });
  const save = () => {
    if (!form.ip.trim() || !form.label.trim()) return toast.error('IP/CIDR and label are required');
    addIpWhitelist(form);
    toast.success('IP added to whitelist');
    setForm({ ip: '', label: '' });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add IP to Whitelist" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Add IP</Button></>}>
      <div className="space-y-4">
        <Input
          label="IP or CIDR (IPv4 or IPv6)"
          placeholder="182.69.180.169 or 2401:4900:1c52:5456:393e:2edb:5a89:644b"
          value={form.ip}
          onChange={(e) => setForm({ ...form, ip: e.target.value })}
        />
        <p className="text-xs text-fg-subtle -mt-2">
          Paste the exact IP shown under Clock In on My Attendance (phones often use IPv6).
          For a whole Wi‑Fi network you can use a /64 prefix, e.g. <code className="text-[11px]">2401:4900:1c52:5456::/64</code>.
        </p>
        <Input label="Label" placeholder="Office Wi‑Fi / Phone" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </div>
    </Modal>
  );
}

function AddDeviceModal({ open, onClose }) {
  const addBiometricDevice = useSettingsStore((s) => s.addBiometricDevice);
  const [form, setForm] = useState({ name: '', deviceId: '', location: '' });
  const save = () => {
    if (!form.name.trim() || !form.deviceId.trim()) return toast.error('Name and device ID are required');
    addBiometricDevice(form);
    toast.success('Device added — create a real API key under Integrations for the device');
    setForm({ name: '', deviceId: '', location: '' });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add Biometric Device" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Add Device</Button></>}>
      <div className="space-y-4">
        <Input label="Device name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Device ID" value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} />
        <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <p className="text-xs text-fg-subtle">Device secrets belong in Settings → Integrations → API Keys (not stored here).</p>
      </div>
    </Modal>
  );
}

function AddShiftModal({ open, onClose }) {
  const addShift = useSettingsStore((s) => s.addShift);
  const [form, setForm] = useState({ name: '', start: '09:00', end: '18:00' });
  const save = () => {
    if (!form.name.trim()) return toast.error('Shift name is required');
    addShift(form);
    toast.success('Shift added');
    setForm({ name: '', start: '09:00', end: '18:00' });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add Shift" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Add Shift</Button></>}>
      <div className="space-y-4">
        <Input label="Shift name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Start time" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <Input label="End time" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

function buildPayload(form, cfg) {
  const devices = (cfg.biometricDevices || []).map(({ apiKey, ...rest }) => rest);
  return {
    ...cfg,
    ...form,
    // Always take live list rows from store (add/remove updates store, not local form)
    ipWhitelist: cfg.ipWhitelist,
    biometricDevices: devices,
    shifts: cfg.shifts,
  };
}

export function AttendanceConfigSection() {
  const qc = useQueryClient();
  const cfg = useSettingsStore((s) => s.attendanceConfig);
  const update = useSettingsStore((s) => s.updateAttendanceConfig);
  const updateTrainingConfig = useSettingsStore((s) => s.updateTrainingConfig);
  const removeIpWhitelist = useSettingsStore((s) => s.removeIpWhitelist);
  const removeBiometricDevice = useSettingsStore((s) => s.removeBiometricDevice);
  const syncBiometricDevice = useSettingsStore((s) => s.syncBiometricDevice);
  const removeShift = useSettingsStore((s) => s.removeShift);
  const [form, setForm] = useState(cfg);
  const [ipModal, setIpModal] = useState(false);
  const [deviceModal, setDeviceModal] = useState(false);
  const [shiftModal, setShiftModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-sync scalar fields when bootstrap (or another tab) updates the store
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      methods: cfg.methods,
      gracePeriodMinutes: cfg.gracePeriodMinutes,
      autoAbsentTime: cfg.autoAbsentTime,
      overtimeAfterHours: cfg.overtimeAfterHours,
      selfieRequired: cfg.selfieRequired,
      newJoinerWindowDays: cfg.newJoinerWindowDays,
      newJoinerDeadlineDays: cfg.newJoinerDeadlineDays,
      orderedNewJoinerVideos: cfg.orderedNewJoinerVideos,
    }));
  }, [
    cfg.methods,
    cfg.gracePeriodMinutes,
    cfg.autoAbsentTime,
    cfg.overtimeAfterHours,
    cfg.selfieRequired,
    cfg.newJoinerWindowDays,
    cfg.newJoinerDeadlineDays,
    cfg.orderedNewJoinerVideos,
  ]);

  const save = async () => {
    const payload = buildPayload(form, cfg);
    update(payload);
    updateTrainingConfig({
      newJoinerWindowDays: payload.newJoinerWindowDays,
      newJoinerDeadlineDays: payload.newJoinerDeadlineDays,
      orderedNewJoinerVideos: payload.orderedNewJoinerVideos,
    });
    setSaving(true);
    try {
      const activeIps = (payload.ipWhitelist || []).filter((i) => i.active !== false && i.ip);
      const cidrList = activeIps.map((i) => String(i.ip).trim()).filter(Boolean);
      await Promise.all([
        updateSettingApi('attendance_config', payload),
        // Office IP whitelist applies to check-in only (login is always allowed from any IP)
        updateSettingApi('office_cidr', cidrList.join(',') || '0.0.0.0/32'),
        updateSettingApi('office_ip', cidrList[0] || ''),
        updateSettingApi('allow_remote_login', true),
      ]);
      await invalidateAndRefetch(qc, ['settings']);
      await invalidateAndRefetch(qc, ['attendance']);
      toast.success('Attendance configuration saved to server');
    } catch (err) {
      toast.error(err.message || 'Saved locally; server sync failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Check-in Methods" subtitle="Toggle which check-in modes employees can use" />
        <div className="p-5 pt-3 space-y-4">
          {Object.entries(METHOD_LABELS).map(([key, [label, hint]]) => (
            <Toggle key={key} label={label} hint={hint} checked={form.methods[key]} onChange={(v) => setForm({ ...form, methods: { ...form.methods, [key]: v } })} />
          ))}
        </div>
      </Card>

      {(form.methods.ipWeb || form.methods.ipApp) && (
        <Card>
          <CardHeader
            title="IP Whitelist"
            subtitle="Applies to office employees on check-in only. Login works from any IP. Set WFH per employee under Employees → Attendance type."
            action={<Button size="sm" icon={Plus} onClick={() => setIpModal(true)}>Add IP</Button>}
          />
          <div className="p-5 pt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left"><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">IP / CIDR</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Label</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Status</th><th className="py-2"></th></tr></thead>
              <tbody>
                {cfg.ipWhitelist.map((ip) => (
                  <tr key={ip.id} className="border-b border-border/50">
                    <td className="py-2.5 font-mono text-xs text-fg">{ip.ip}</td>
                    <td className="py-2.5 text-fg-muted">{ip.label}</td>
                    <td className="py-2.5"><Badge tone={ip.active ? 'success' : 'neutral'}>{ip.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="py-2.5 text-right"><button type="button" onClick={() => removeIpWhitelist(ip.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {form.methods.biometric && (
        <Card>
          <CardHeader title="Biometric Devices" action={<Button size="sm" icon={Plus} onClick={() => setDeviceModal(true)}>Add Device</Button>} />
          <div className="p-5 pt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left"><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Device</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Location</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Last Sync</th><th className="py-2"></th></tr></thead>
              <tbody>
                {cfg.biometricDevices.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-fg-subtle text-sm">No biometric devices configured yet.</td></tr>
                ) : cfg.biometricDevices.map((d) => (
                  <tr key={d.id} className="border-b border-border/50">
                    <td className="py-2.5 text-fg">{d.name} <span className="text-fg-subtle text-xs">({d.deviceId})</span></td>
                    <td className="py-2.5 text-fg-muted">{d.location}</td>
                    <td className="py-2.5 text-fg-muted text-xs">{d.lastSync ? new Date(d.lastSync).toLocaleString() : 'Never'}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => { syncBiometricDevice(d.id); toast.success('Test connection succeeded'); }}>Test</Button>
                        <button type="button" onClick={() => removeBiometricDevice(d.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Shift Timings" action={<Button size="sm" icon={Plus} onClick={() => setShiftModal(true)}>Add Shift</Button>} />
        <div className="p-5 pt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left"><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Shift Name</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Start</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">End</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Active</th><th className="py-2"></th></tr></thead>
            <tbody>
              {cfg.shifts.map((sh) => (
                <tr key={sh.id} className="border-b border-border/50">
                  <td className="py-2.5 text-fg font-medium">{sh.name}</td>
                  <td className="py-2.5 text-fg-muted">{sh.start}</td>
                  <td className="py-2.5 text-fg-muted">{sh.end}</td>
                  <td className="py-2.5"><Badge tone={sh.active ? 'success' : 'neutral'}>{sh.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="py-2.5 text-right"><button type="button" onClick={() => removeShift(sh.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Rules" />
        <div className="p-5 pt-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Grace period for late arrival (minutes)" type="number" value={form.gracePeriodMinutes} onChange={(e) => setForm({ ...form, gracePeriodMinutes: Number(e.target.value) })} />
            <Input label="Auto-mark absent if no check-in by" type="time" value={form.autoAbsentTime} onChange={(e) => setForm({ ...form, autoAbsentTime: e.target.value })} />
            <Input label="Overtime calculation after (hours/day)" type="number" value={form.overtimeAfterHours} onChange={(e) => setForm({ ...form, overtimeAfterHours: Number(e.target.value) })} />
            <Input label="New joiner training window (days)" type="number" value={form.newJoinerWindowDays} onChange={(e) => setForm({ ...form, newJoinerWindowDays: Number(e.target.value) })} />
            <Input label="New joiner training deadline (days)" type="number" value={form.newJoinerDeadlineDays} onChange={(e) => setForm({ ...form, newJoinerDeadlineDays: Number(e.target.value) })} />
          </div>
          <Toggle label="Selfie required on check-in" hint="Applies to web + app check-in" checked={form.selfieRequired} onChange={(v) => setForm({ ...form, selfieRequired: v })} />
          <Toggle label="Enforce new joiner video watch order" hint="Next video unlocks only after the previous is completed" checked={form.orderedNewJoinerVideos} onChange={(v) => setForm({ ...form, orderedNewJoinerVideos: v })} />
        </div>
        <div className="px-5 pb-5 flex justify-end">
          <Button icon={Save} onClick={save} loading={saving}>Save Changes</Button>
        </div>
      </Card>

      <AddIpModal open={ipModal} onClose={() => setIpModal(false)} />
      <AddDeviceModal open={deviceModal} onClose={() => setDeviceModal(false)} />
      <AddShiftModal open={shiftModal} onClose={() => setShiftModal(false)} />
    </div>
  );
}
