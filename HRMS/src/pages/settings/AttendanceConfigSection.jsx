import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Toggle, Badge, Modal, SaveStatusIndicator } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { updateSettingApi } from '../../api/settings.api';
import { listIpWhitelistApi, createIpWhitelistEntryApi, removeIpWhitelistEntryApi } from '../../api/ipWhitelist.api';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { DeviceMappingSection } from './DeviceMappingSection';
import { AdmsDevicesSection } from './AdmsDevicesSection';
import { BeaconManagementSection } from './BeaconManagementSection';
import { GeofenceManagementSection } from './GeofenceManagementSection';
import { useCompanyFeatures } from '../../hooks/useCompanyFeatures';
import { useAutosave } from '../../hooks/useAutosave';

// Section B: featureKey maps each method to its entitlement — a non-
// entitled method is hidden entirely (Section B's "no upgrade-prompt
// clutter, just absent"). comingSoon methods (app, ipApp) always render,
// always disabled, regardless of entitlement — inert until
// MOBILE_APP_AVAILABLE flips, per Section B.
// Keys here are camelCase to match what /companies/me/features actually
// returns (see company.controller.js's myFeatures) — a snake_case key
// silently never matches enabledFeatures, hiding the whole method/section
// unconditionally even when the entitlement is genuinely on.
const METHOD_LABELS = {
  web: ['Web Check-in', 'Browser on desktop or phone', 'webCheckin'],
  app: ['App Check-in', 'Coming soon', 'appCheckin'],
  biometric: ['Biometric Device', 'Physical device pushes via webhook', 'biometricAdms'],
  ipWeb: ['IP-based Web', 'Office employees must check in from whitelisted IP', 'ipBasedWeb'],
  ipApp: ['IP-based App', 'Coming soon', 'ipBasedApp'],
};
const COMING_SOON_METHODS = ['app', 'ipApp'];

/**
 * Section 0/C: writes directly to the real ip_whitelist table (immediate,
 * not batched with the rest of this page's "Save Changes" — matching how
 * Beacon/Geofence management already work) — this used to add to a local
 * array that synced into a settings JSON blob nothing server-side ever
 * enforced against.
 */
function AddIpModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ ip: '', label: '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.ip.trim() || !form.label.trim()) return toast.error('IP/CIDR and label are required');
    setSaving(true);
    try {
      await createIpWhitelistEntryApi(form.ip.trim(), form.label.trim());
      toast.success('IP added to whitelist');
      setForm({ ip: '', label: '' });
      onCreated?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not add IP');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add IP to Whitelist" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Add IP</Button></>}>
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

function AddShiftModal({ open, onClose, onAdded }) {
  const addShift = useSettingsStore((s) => s.addShift);
  const [form, setForm] = useState({ name: '', start: '09:00', end: '18:00' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.name.trim()) return toast.error('Shift name is required');
    setSaving(true);
    try {
      addShift(form);
      await onAdded();
      toast.success('Shift added');
      setForm({ name: '', start: '09:00', end: '18:00' });
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to save shift');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add Shift" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Add Shift</Button></>}>
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
  return {
    ...cfg,
    ...form,
    // Always take live list rows from store (add/remove updates store, not local form)
    ipWhitelist: cfg.ipWhitelist,
    shifts: cfg.shifts,
  };
}

export function AttendanceConfigSection() {
  const qc = useQueryClient();
  // Item 8B: device management is a completely separate concern from IP-based
  // check-in config also in this tab — only these two sections are gated,
  // not the whole "Attendance Config" tab, so non-biometric config stays usable.
  const enabledFeatures = useCompanyFeatures();
  const biometricAdmsEnabled = enabledFeatures ? Boolean(enabledFeatures.biometricAdms) : true;
  const cfg = useSettingsStore((s) => s.attendanceConfig);
  const update = useSettingsStore((s) => s.updateAttendanceConfig);
  const updateTrainingConfig = useSettingsStore((s) => s.updateTrainingConfig);
  const removeShift = useSettingsStore((s) => s.removeShift);
  const [form, setForm] = useState(cfg);
  const [ipModal, setIpModal] = useState(false);
  const [shiftModal, setShiftModal] = useState(false);

  const ipWebEntitled = enabledFeatures ? Boolean(enabledFeatures.ipBasedWeb) : true;
  const gpsEntitled = enabledFeatures ? Boolean(enabledFeatures.gpsGeofence) : true;
  const { data: whitelistEntries = [], refetch: refetchWhitelist } = useQuery({
    queryKey: ['ip-whitelist'],
    queryFn: listIpWhitelistApi,
    enabled: ipWebEntitled,
  });
  const removeWhitelistEntry = async (id) => {
    try {
      await removeIpWhitelistEntryApi(id);
      toast.success('Removed');
      await refetchWhitelist();
    } catch (err) {
      toast.error(err.message || 'Could not remove entry');
    }
  };

  // Re-sync scalar fields when bootstrap (or another tab) updates the store
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      methods: cfg.methods,
      gpsGeofenceEnabled: cfg.gpsGeofenceEnabled,
      requireBothLocationChecks: cfg.requireBothLocationChecks,
      gracePeriodMinutes: cfg.gracePeriodMinutes,
      checkoutGracePeriodMinutes: cfg.checkoutGracePeriodMinutes,
      halfDayThresholdPercent: cfg.halfDayThresholdPercent,
      autoAbsentTime: cfg.autoAbsentTime,
      overtimeAfterHours: cfg.overtimeAfterHours,
      selfieRequired: cfg.selfieRequired,
      newJoinerWindowDays: cfg.newJoinerWindowDays,
      newJoinerDeadlineDays: cfg.newJoinerDeadlineDays,
      orderedNewJoinerVideos: cfg.orderedNewJoinerVideos,
    }));
  }, [
    cfg.methods,
    cfg.gpsGeofenceEnabled,
    cfg.requireBothLocationChecks,
    cfg.gracePeriodMinutes,
    cfg.checkoutGracePeriodMinutes,
    cfg.halfDayThresholdPercent,
    cfg.autoAbsentTime,
    cfg.overtimeAfterHours,
    cfg.selfieRequired,
    cfg.newJoinerWindowDays,
    cfg.newJoinerDeadlineDays,
    cfg.orderedNewJoinerVideos,
  ]);

  /**
   * Item 4: toggles (check-in methods, GPS enforce/require-both, selfie,
   * watch-order) call `patch()` and save immediately. Number/time fields in
   * "Rules" keep onChange local-only and save onBlur. Shift add/remove
   * already mutate the store instantly (via addShift/removeShift below) —
   * this is what actually persists that to the server now, since there's
   * no more page-level Save button to do it afterward.
   */
  const doSave = useCallback(async (nextForm) => {
    const payload = buildPayload(nextForm, useSettingsStore.getState().attendanceConfig);
    update(payload);
    updateTrainingConfig({
      newJoinerWindowDays: payload.newJoinerWindowDays,
      newJoinerDeadlineDays: payload.newJoinerDeadlineDays,
      orderedNewJoinerVideos: payload.orderedNewJoinerVideos,
    });
    // Section 0/C: office-IP enforcement now reads the real ip_whitelist
    // table directly (managed live via the card below) — no more shadow
    // office_cidr/office_ip/allow_remote_login settings writes, which
    // nothing enforces against anymore now that assertOfficeIpAllowed
    // reads the real table.
    await updateSettingApi('attendance_config', payload);
    await invalidateAndRefetch(qc, ['settings']);
    await invalidateAndRefetch(qc, ['attendance']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, update, updateTrainingConfig]);
  const { status, save, retry } = useAutosave(doSave);

  const patch = (partial) => {
    setForm((prev) => {
      const next = typeof partial === 'function' ? partial(prev) : { ...prev, ...partial };
      save(next);
      return next;
    });
  };
  /** doSave re-reads shifts/ipWhitelist fresh from the store, so this also covers shift add/remove. */
  const saveNow = () => save(form);

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><SaveStatusIndicator status={status} onRetry={retry} /></div>
      <Card>
        <CardHeader title="Check-in Methods" subtitle="Toggle which check-in modes employees can use" />
        <div className="p-5 pt-3 space-y-4">
          {Object.entries(METHOD_LABELS)
            // Section B: a non-entitled method is hidden entirely — no
            // upgrade-prompt clutter. Coming-soon methods always render
            // (disabled) so their state is visible, never hidden or toggleable.
            .filter(([key, [, , featureKey]]) => COMING_SOON_METHODS.includes(key) || !enabledFeatures || enabledFeatures[featureKey] !== false)
            .map(([key, [label, hint]]) => {
              const comingSoon = COMING_SOON_METHODS.includes(key);
              return (
                <Toggle
                  key={key}
                  label={comingSoon ? `${label} (Coming soon)` : label}
                  hint={hint}
                  checked={comingSoon ? false : form.methods[key]}
                  disabled={comingSoon}
                  onChange={(v) => patch({ methods: { ...form.methods, [key]: v } })}
                />
              );
            })}

          {/* GPS geofencing is a location check layered onto web/IP-based
              check-in, not a check-in method of its own — it's meaningless
              with both of those off (no method left for it to apply to),
              so it lives here and is gated the same way. */}
          {gpsEntitled && (form.methods.web || form.methods.ipWeb) && (
            <div className="pt-4 mt-4 border-t border-border space-y-4">
              <Toggle
                label="Enforce GPS geofencing on check-in"
                hint="Off by default. Add office locations below, then turn this on to require employees be at one of them to check in."
                checked={Boolean(form.gpsGeofenceEnabled)}
                onChange={(v) => patch({ gpsGeofenceEnabled: v })}
              />
              {form.gpsGeofenceEnabled && ipWebEntitled && form.methods.ipWeb && (
                <Toggle
                  label="Require both IP whitelist and GPS location"
                  hint="Off (default): either check passing is enough. On: both must pass."
                  checked={Boolean(form.requireBothLocationChecks)}
                  onChange={(v) => patch({ requireBothLocationChecks: v })}
                />
              )}
            </div>
          )}
        </div>
      </Card>

      {ipWebEntitled && (form.methods.ipWeb || form.methods.ipApp) && (
        <Card>
          <CardHeader
            title="IP Whitelist"
            subtitle="Applies to office employees on check-in only. Login works from any IP. Set WFH per employee under Employees → Attendance type."
            action={<Button size="sm" icon={Plus} onClick={() => setIpModal(true)}>Add IP</Button>}
          />
          <div className="p-5 pt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left"><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">IP / CIDR</th><th className="py-2 font-semibold text-fg-subtle text-xs uppercase">Label</th><th className="py-2"></th></tr></thead>
              <tbody>
                {whitelistEntries.map((ip) => (
                  <tr key={ip.id} className="border-b border-border/50">
                    <td className="py-2.5 font-mono text-xs text-fg">{ip.cidr}</td>
                    <td className="py-2.5 text-fg-muted">{ip.label || '—'}</td>
                    <td className="py-2.5 text-right"><button type="button" onClick={() => removeWhitelistEntry(ip.id)} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Gap fix: entitlement alone isn't enough — a company can also turn
          IP-based Web off for itself via the Check-in Methods toggle
          above (form.methods.ipWeb), and beacons only make sense with
          the method actually on, same standard as the IP Whitelist card
          right above. */}
      {ipWebEntitled && form.methods.ipWeb && <BeaconManagementSection />}

      {/* Same standard as Beacon/IP Whitelist above: entitlement alone
          isn't enough, locations only matter once enforcement is actually
          on. Safe to gate this way — 0 geofences configured means
          enforcement is a no-op server-side (geofence.service.js's
          isWithinAnyGeofence fails open), so toggling Enforce on first
          never locks anyone out before a location is added. */}
      {gpsEntitled && form.gpsGeofenceEnabled && <GeofenceManagementSection />}

      {biometricAdmsEnabled && form.methods.biometric && (
        <>
          <AdmsDevicesSection />
          <DeviceMappingSection />
        </>
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
                  <td className="py-2.5 text-right"><button type="button" onClick={() => { removeShift(sh.id); saveNow(); }} className="p-1.5 rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button></td>
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
            <Input label="Grace period for late arrival (minutes)" type="number" value={form.gracePeriodMinutes} onChange={(e) => setForm({ ...form, gracePeriodMinutes: Number(e.target.value) })} onBlur={saveNow} />
            <Input label="Auto-mark absent if no check-in by" type="time" value={form.autoAbsentTime} onChange={(e) => setForm({ ...form, autoAbsentTime: e.target.value })} onBlur={saveNow} />
            <Input label="Overtime calculation after (hours/day)" type="number" value={form.overtimeAfterHours} onChange={(e) => setForm({ ...form, overtimeAfterHours: Number(e.target.value) })} onBlur={saveNow} />
            {biometricAdmsEnabled && form.methods.biometric && (
              <>
                <Input
                  label="Biometric checkout grace period (minutes)"
                  hint="How long past shift end to wait before a biometric session's checkout/status becomes visible"
                  type="number"
                  value={form.checkoutGracePeriodMinutes}
                  onChange={(e) => setForm({ ...form, checkoutGracePeriodMinutes: Number(e.target.value) })}
                  onBlur={saveNow}
                />
                <Input
                  label="Half-day threshold (% of shift duration)"
                  hint="Below this, a biometric day is marked Half Day"
                  type="number"
                  min={1}
                  max={99}
                  value={form.halfDayThresholdPercent}
                  onChange={(e) => setForm({ ...form, halfDayThresholdPercent: Number(e.target.value) })}
                  onBlur={saveNow}
                />
              </>
            )}
            <Input label="New joiner training window (days)" type="number" value={form.newJoinerWindowDays} onChange={(e) => setForm({ ...form, newJoinerWindowDays: Number(e.target.value) })} onBlur={saveNow} />
            <Input label="New joiner training deadline (days)" type="number" value={form.newJoinerDeadlineDays} onChange={(e) => setForm({ ...form, newJoinerDeadlineDays: Number(e.target.value) })} onBlur={saveNow} />
          </div>
          <Toggle label="Selfie required on check-in" hint="Applies to web + app check-in" checked={form.selfieRequired} onChange={(v) => patch({ selfieRequired: v })} />
          <Toggle label="Enforce new joiner video watch order" hint="Next video unlocks only after the previous is completed" checked={form.orderedNewJoinerVideos} onChange={(v) => patch({ orderedNewJoinerVideos: v })} />
        </div>
      </Card>

      <AddIpModal open={ipModal} onClose={() => setIpModal(false)} onCreated={refetchWhitelist} />
      <AddShiftModal open={shiftModal} onClose={() => setShiftModal(false)} onAdded={saveNow} />
    </div>
  );
}
