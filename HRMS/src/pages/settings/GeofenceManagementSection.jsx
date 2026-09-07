import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, LocateFixed } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Badge, Modal, EmptyState, Skeleton } from '../../components/ui';
import { listGeofencesApi, createGeofenceApi, deactivateGeofenceApi } from '../../api/geofence.api';

const MIN_RADIUS = 20;
const MAX_RADIUS = 2000;

/** Section E: manual lat/long entry — no mapping library dependency, matching the instruction not to add one unless already present. */
export function GeofenceManagementSection() {
  const qc = useQueryClient();
  const { data: fences = [], isLoading } = useQuery({ queryKey: ['geofences'], queryFn: listGeofencesApi });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [form, setForm] = useState({ label: '', center_latitude: '', center_longitude: '', radius_meters: '150' });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['geofences'] });

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Your browser does not support location access');
      return;
    }
    setLocating(true);

    const onSuccess = (pos) => {
      setForm((f) => ({
        ...f,
        center_latitude: String(pos.coords.latitude),
        center_longitude: String(pos.coords.longitude),
      }));
      toast.success('Location filled — you can still edit it before saving');
      setLocating(false);
    };

    // A desktop with no GPS chip can fail a high-accuracy request
    // (POSITION_UNAVAILABLE/TIMEOUT) while the browser's coarser
    // network/Wi-Fi-based lookup still works fine — retry once with that
    // before giving up, instead of making the user fall back to typing
    // coordinates for something the browser can usually still resolve.
    const attempt = (opts, isRetry) => {
      navigator.geolocation.getCurrentPosition(onSuccess, (err) => {
        if (!isRetry && err.code !== err.PERMISSION_DENIED) {
          attempt({ enableHighAccuracy: false, timeout: 15_000 }, true);
          return;
        }
        const message = err.code === err.PERMISSION_DENIED
          ? 'Location permission denied — check your browser\'s site settings and try again, or enter coordinates manually'
          : err.code === err.TIMEOUT
            ? 'Location request timed out — check your device\'s location/Wi-Fi is on, or enter coordinates manually'
            : 'Could not determine your location — on macOS, check System Settings > Privacy & Security > Location Services is on for your browser, or enter coordinates manually';
        toast.error(message, { duration: 6000 });
        setLocating(false);
      }, opts);
    };
    attempt({ enableHighAccuracy: true, timeout: 8_000 }, false);
  };

  const submit = async () => {
    if (!form.label.trim() || form.center_latitude === '' || form.center_longitude === '') {
      toast.error('Label, latitude, and longitude are required');
      return;
    }
    setBusy(true);
    try {
      await createGeofenceApi({
        label: form.label.trim(),
        center_latitude: Number(form.center_latitude),
        center_longitude: Number(form.center_longitude),
        radius_meters: Number(form.radius_meters) || 150,
      });
      toast.success('Geofence created');
      setOpen(false);
      setForm({ label: '', center_latitude: '', center_longitude: '', radius_meters: '150' });
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not create geofence');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (fence) => {
    setBusy(true);
    try {
      await deactivateGeofenceApi(fence.id);
      toast.success('Geofence deactivated');
      await invalidate();
    } catch (err) {
      toast.error(err.message || 'Could not deactivate');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Geofence Locations"
        subtitle="Office locations employees must be within to check in — supports multiple branches."
        action={<Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Add location</Button>}
      />
      <div className="px-5 pb-5">
        {isLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : fences.length === 0 ? (
          <EmptyState icon={MapPin} title="No locations yet" message="Add your office's coordinates to enable GPS check-in." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['Label', 'Center', 'Radius', 'Status', ''].map((h) => (
                  <th key={h || 'actions'} className="py-2 font-semibold text-fg-subtle text-xs uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fences.map((f) => (
                <tr key={f.id} className="border-b border-border/50">
                  <td className="py-2.5 text-fg font-medium">{f.label}</td>
                  <td className="py-2.5 font-mono text-xs text-fg-muted">{f.center_latitude.toFixed(5)}, {f.center_longitude.toFixed(5)}</td>
                  <td className="py-2.5 text-fg-muted">{f.radius_meters}m</td>
                  <td className="py-2.5"><Badge tone={f.is_active ? 'success' : 'neutral'}>{f.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className="py-2.5 text-right">
                    {f.is_active && <Button size="sm" variant="outline" loading={busy} onClick={() => deactivate(f)}>Deactivate</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add geofence location"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={busy} onClick={submit}>Create</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <Input label="Label" placeholder="e.g. Bangalore HQ" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-fg-subtle uppercase">Coordinates</span>
            <Button type="button" size="sm" variant="outline" icon={LocateFixed} loading={locating} onClick={useCurrentLocation}>
              Use current location
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Latitude" type="number" step="any" value={form.center_latitude} onChange={(e) => setForm((f) => ({ ...f, center_latitude: e.target.value }))} />
            <Input label="Longitude" type="number" step="any" value={form.center_longitude} onChange={(e) => setForm((f) => ({ ...f, center_longitude: e.target.value }))} />
          </div>
          <Input
            label={`Radius in meters (${MIN_RADIUS}–${MAX_RADIUS})`}
            type="number"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            value={form.radius_meters}
            onChange={(e) => setForm((f) => ({ ...f, radius_meters: e.target.value }))}
          />
        </div>
      </Modal>
    </Card>
  );
}
