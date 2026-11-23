import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Fingerprint, CheckCircle2, Loader2, ShieldCheck, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Button, Input, Modal, Badge, EmptyState, Skeleton, ConfirmDialog } from '../../components/ui';
import {
  useAdmsStatus, useUpdateAdmsDevice, useAllowAdmsDeviceNewIp, useRejectAdmsDeviceNewIp,
  useDeviceIpApprovers, useSaveDeviceIpApprovers, useImportAdmsPunches,
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
/** "2 people" / "1 person" */
const peopleCount = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** "20 Nov, 9:30 am – 10:15 am", or across days "19 Nov, 6:02 pm – 20 Nov, 9:41 am". */
function timeRange(firstIso, lastIso) {
  if (!firstIso) return '';
  const first = new Date(firstIso);
  const last = new Date(lastIso || firstIso);
  const time = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (first.getTime() === last.getTime()) return shortDateTime(firstIso);
  return first.toDateString() === last.toDateString()
    ? `${shortDateTime(firstIso)} – ${time(last)}`
    : `${shortDateTime(firstIso)} – ${shortDateTime(lastIso)}`;
}

/** "198.51.100.20 (near Noida)" */
const withArea = (ip, near) => (ip ? `${ip}${near ? ` (near ${near})` : ''}` : 'none');

/** What a waiting IP has sent so far, in one line. */
function waitingSummary(request) {
  return request.kept
    ? `${punchCount(request.kept)} by ${peopleCount(request.people)}, ${timeRange(request.firstPunchAt, request.lastPunchAt)}.`
    : 'No punches yet.';
}

/**
 * One new IP a machine is calling from (owner's rules, 20 Nov 2026): its
 * punches are kept, not counted, until someone decides. Approve → they count
 * at the times they were made. Reject → they are deleted.
 */
function WaitingIp({ device, request, canApprove, onAllow, onReject }) {
  const stillOnline = isOnline(device.lastSeenAt);
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="warning">New IP waiting: <span className="font-mono">{request.ip}</span></Badge>
        {request.near ? <span className="text-[11px] text-fg-subtle">near {request.near}</span> : null}
      </div>
      <p className="text-[11px] text-fg-subtle">{waitingSummary(request)}</p>
      {stillOnline ? (
        <p className="text-[11px] text-danger">
          The machine is online right now on its allowed IP. An office internet change doesn&apos;t look like this: someone may be using its serial number.
        </p>
      ) : null}
      {request.rejectedBefore ? (
        <p className="text-[11px] text-fg-subtle">Rejected on {shortDateTime(request.rejectedBefore)}; nobody was told again.</p>
      ) : null}
      {canApprove ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Button size="sm" variant="secondary" onClick={() => onAllow(device, request)}>Approve</Button>
          <Button size="sm" variant="ghost" onClick={() => onReject(device, request)}>Reject</Button>
        </div>
      ) : (
        <p className="text-[11px] text-fg-subtle">Waiting for one of the people chosen below.</p>
      )}
    </div>
  );
}

/**
 * The IP a device is pinned to. Punches count only from it; any other IP it
 * calls from waits here for a decision. Before the kept-punches migration
 * (`keepsPunches` false) there is one waiting IP and its punches are refused.
 */
function DeviceIpCell({ device, keepsPunches, canApprove, onAllow, onReject }) {
  const requests = device.ipRequests || [];
  return (
    <div className="space-y-1.5">
      {device.allowedIp ? (
        <span className="font-mono text-xs text-fg">{device.allowedIp}</span>
      ) : (
        <span className="text-xs text-fg-subtle italic">Learns on next contact</span>
      )}
      {keepsPunches
        ? requests.map((r) => (
          <WaitingIp key={r.id} device={device} request={r} canApprove={canApprove} onAllow={onAllow} onReject={onReject} />
        ))
        : device.pendingIp ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="warning">New IP waiting: <span className="font-mono">{device.pendingIp}</span></Badge>
            {canApprove ? (
              <Button size="sm" variant="secondary" onClick={() => onAllow(device, { ip: device.pendingIp, kept: 0 })}>Allow new IP</Button>
            ) : null}
          </div>
        ) : null}
    </div>
  );
}

/**
 * Settings → Attendance → Biometric Devices: who is asked to approve a
 * machine's new internet address (IP) — by email, and on WhatsApp. Every HR
 * and Admin by default; anyone else (e.g. the tech team) can be ticked as
 * well. Only an Admin changes the list.
 */
function IpApproversCard({ keepsPunches }) {
  const { data, isLoading } = useDeviceIpApprovers();
  const save = useSaveDeviceIpApprovers();
  const { employees = [], isLoading: peopleLoading } = useEmployees();
  const companyId = useAuthStore((s) => s.user?.companyId || null);
  const isAdmin = useAuthStore((s) => s.role) === 'admin';
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
          ? "When a machine's internet address changes (new connection, router restart), its punches are kept, not lost, until one of these people decides. Approve: they count at the times they were made. Reject: they are deleted."
          : "When a machine's internet address changes (new connection, router restart), these people are told by email so they can allow the new IP above."}
      />
      <div className="p-5 pt-3 space-y-4">
        {isLoading ? <Skeleton className="h-16 w-full" /> : (
          <>
            {!isAdmin ? (
              <p className="text-xs text-fg-subtle">Only an Admin can change who approves.</p>
            ) : null}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {[['admin', 'All Admins'], ['hr', 'All HR']].map(([role, label]) => (
                <label key={role} className={`inline-flex items-center gap-2 text-sm text-fg ${isAdmin ? 'cursor-pointer' : 'opacity-70'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.roles.includes(role)} disabled={!isAdmin} onChange={() => toggleRole(role)} />
                  {label}
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-fg">Anyone else (optional)</p>
                <p className="text-xs text-fg-subtle">For example the person who looks after your office internet. People who aren&apos;t HR or Admin decide on WhatsApp.</p>
              </div>
              {isAdmin ? <Input placeholder="Search by name, department or designation" value={search} onChange={(e) => setSearch(e.target.value)} /> : null}
              <div className="max-h-56 overflow-y-auto rounded-input border border-border divide-y divide-border/50">
                {peopleLoading ? (
                  <div className="p-3"><Skeleton className="h-8 w-full" /></div>
                ) : (isAdmin ? shown : others.filter((e) => value.employeeIds.includes(e.id))).length === 0 ? (
                  <p className="px-3 py-4 text-xs text-fg-subtle">
                    {!isAdmin ? 'Nobody else is chosen.' : others.length ? 'Nobody matches that search.' : 'No other employees yet.'}
                  </p>
                ) : (isAdmin ? shown : others.filter((e) => value.employeeIds.includes(e.id))).map((e) => (
                  <label key={e.id} className={`flex items-center gap-3 px-3 py-2 ${isAdmin ? 'cursor-pointer hover:bg-muted/40' : ''}`}>
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={value.employeeIds.includes(e.id)} disabled={!isAdmin} onChange={() => togglePerson(e.id)} />
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
                    ? 'Everyone chosen gets an email. On WhatsApp, the Approve / Reject buttons only go to people who connected WhatsApp themselves (their profile → WhatsApp); the others get the message and decide here.'
                    : 'Everyone chosen gets the email.'}
              </p>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  {dirty ? <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Undo</Button> : null}
                  <Button size="sm" icon={ShieldCheck} onClick={onSave} disabled={!dirty || nobody} loading={save.isPending}>Save</Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

const ISO_DAY = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const FILE_DATE = /(\d{4})[-/](\d{2})[-/](\d{2})/;
const MAX_FILE_LINES = 20000;

/**
 * Punches the server never received (e.g. refused from a new IP): an Admin
 * downloads the attendance file from the machine (USB) and adds the chosen
 * dates. Only the lines for those dates are sent; the server previews first,
 * skips punches already in SpaxSync, and works attendance out again.
 */
function ImportPunchesModal({ device, onClose }) {
  const importPunches = useImportAdmsPunches();
  const [fileName, setFileName] = useState('');
  const [fileLines, setFileLines] = useState(null);
  const [from, setFrom] = useState(ISO_DAY(-1));
  const [to, setTo] = useState(ISO_DAY(0));
  const [preview, setPreview] = useState(null);

  const readFile = async (file) => {
    setPreview(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error('That file is too big. Choose the attendance file from the machine.');
      return;
    }
    setFileName(file.name);
    setFileLines(String(await file.text()).split(/\r?\n/));
  };

  /** The header (for eSSL's EnNo / DateTime export) and the lines dated from–to. */
  const linesForDates = () => (fileLines || []).filter((line) => {
    if (/\benno\b/i.test(line) && /date\s*time/i.test(line)) return true;
    const m = line.match(FILE_DATE);
    if (!m) return false;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    return day >= from && day <= to;
  });

  const run = async (dryRun) => {
    const lines = linesForDates();
    if (!lines.length) {
      toast.error('This file has no punches on those dates');
      return;
    }
    if (lines.length > MAX_FILE_LINES) {
      toast.error('Too many punches at once. Choose fewer days.');
      return;
    }
    try {
      const result = await importPunches.mutateAsync({ serial: device.deviceSerial, lines, from, to, dryRun });
      if (dryRun) {
        setPreview(result);
      } else {
        toast.success(`${punchCount(result.saved)} added. Attendance for those days is worked out again.`);
        onClose();
      }
    } catch (err) {
      toast.error(err.message || 'Could not read the file');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add punches from the machine's file — ${device.name || device.deviceSerial}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {preview && preview.toAdd > 0 ? (
          <Button onClick={() => run(false)} loading={importPunches.isPending}>Add {punchCount(preview.toAdd)}</Button>
        ) : (
          <Button onClick={() => run(true)} loading={importPunches.isPending} disabled={!fileLines}>Check the file</Button>
        )}
      </>}
    >
      <div className="space-y-4">
        <ol className="list-decimal pl-5 text-xs text-fg-subtle space-y-1">
          <li>On the machine: Menu → USB (Pen Drive) → Download → Attendance data.</li>
          <li>Plug the pen drive into this computer and choose the file below (for example <span className="font-mono">attlog.dat</span>).</li>
          <li>Choose the days that are missing. Punches already in SpaxSync are skipped, so nothing is added twice.</li>
        </ol>
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">File from the machine</span>
          <input
            type="file"
            accept=".dat,.txt,.csv,.tsv,.log"
            className="mt-1 block w-full text-sm text-fg file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-primary"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
          {fileName ? <span className="mt-1 block text-[11px] text-fg-subtle">{fileName}: {fileLines?.length || 0} lines</span> : null}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input type="date" label="From" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} />
          <Input type="date" label="To" value={to} min={from} max={ISO_DAY(0)} onChange={(e) => { setTo(e.target.value); setPreview(null); }} />
        </div>
        {preview ? (
          <div className="rounded-md border border-border p-3 space-y-2 text-sm">
            <p className="text-fg">
              {preview.toAdd
                ? `${punchCount(preview.toAdd)} by ${peopleCount(preview.people)} can be added.`
                : 'Nothing to add: every punch on those days is already in SpaxSync.'}
              {preview.alreadyThere ? ` ${punchCount(preview.alreadyThere)} already there.` : ''}
            </p>
            {preview.days?.length ? (
              <ul className="text-xs text-fg-subtle space-y-0.5">
                {preview.days.map((d) => <li key={d.date}>{d.date}: {punchCount(d.count)}</li>)}
              </ul>
            ) : null}
            {preview.notLinkedCount ? (
              <p className="text-xs text-warning">
                {preview.notLinkedCount} machine user ID{preview.notLinkedCount === 1 ? ' is' : 's are'} not linked to an employee ({preview.notLinked.join(', ')}{preview.notLinkedCount > preview.notLinked.length ? ', …' : ''}).
                Their punches are saved but count only once linked under device mapping.
              </p>
            ) : null}
            {preview.unreadable ? (
              <p className="text-xs text-fg-subtle">{preview.unreadable} line{preview.unreadable === 1 ? '' : 's'} could not be read and {preview.unreadable === 1 ? 'is' : 'are'} skipped.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function AdmsDevicesSection() {
  const { data, isLoading } = useAdmsStatus();
  const isAdmin = useAuthStore((s) => s.role) === 'admin';
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(null);
  const [allowing, setAllowing] = useState(null); // { device, request }
  const [rejecting, setRejecting] = useState(null);
  const allowNewIp = useAllowAdmsDeviceNewIp();
  const rejectNewIp = useRejectAdmsDeviceNewIp();
  const devices = data?.devices || [];
  const keepsPunches = Boolean(data?.keepsPunches);
  const canApprove = Boolean(data?.canApprove ?? isAdmin);
  const now = useNow();

  const confirmAllow = async () => {
    const { device, request } = allowing;
    try {
      const result = await allowNewIp.mutateAsync({ serial: device.deviceSerial, ip: request.ip });
      const kept = result?.keptPunches ? ` The ${punchCount(result.keptPunches)} kept since then are being added now.` : '';
      toast.success(`Punches from ${request.ip} will now be accepted.${kept}`);
    } catch (err) {
      toast.error(err.message || 'Could not approve the new IP');
    }
    setAllowing(null);
  };

  const confirmReject = async () => {
    const { device, request } = rejecting;
    try {
      const result = await rejectNewIp.mutateAsync({ serial: device.deviceSerial, ip: request.ip });
      const deleted = result?.deletedPunches ? ` Its ${punchCount(result.deletedPunches)} were deleted.` : '';
      toast.success(`${request.ip} was rejected.${deleted}`);
    } catch (err) {
      toast.error(err.message || 'Could not reject the new IP');
    }
    setRejecting(null);
  };

  const allowMessage = () => {
    if (!allowing) return '';
    const { device, request } = allowing;
    const name = device.name || device.deviceSerial;
    const counts = request.kept
      ? ` The ${punchCount(request.kept)} by ${peopleCount(request.people)} kept from it (${timeRange(request.firstPunchAt, request.lastPunchAt)}) will count, at the times they were made.`
      : '';
    const warning = isOnline(device.lastSeenAt)
      ? ' Careful: the machine is online right now on its allowed IP, which an office internet change does not look like.'
      : '';
    return `Punches for ${name} will be accepted from ${withArea(request.ip, request.near)} instead of ${withArea(device.allowedIp || request.previousIp, request.previousNear)}.${counts}${warning} Only approve it if your office's internet connection changed. If nothing changed, someone may be using this machine's serial number to send fake attendance.`;
  };

  const rejectMessage = () => {
    if (!rejecting) return '';
    const { device, request } = rejecting;
    const counts = request.kept ? ` Its ${punchCount(request.kept)} are deleted and never count.` : '';
    return `${device.name || device.deviceSerial} stays allowed only from ${device.allowedIp || 'its old IP'}.${counts} If ${request.ip} keeps sending, its punches are kept again and shown here, but nobody is told again for 7 days.`;
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
                  <tr key={d.deviceSerial} className="border-b border-border/50 align-top">
                    <td className="py-2.5 font-mono text-xs text-fg">{d.deviceSerial}</td>
                    <td className="py-2.5 text-fg-muted">{d.name || <span className="text-fg-subtle italic">Unlabeled</span>}</td>
                    <td className="py-2.5 text-fg-muted">{d.location || '—'}</td>
                    <td className="py-2.5 text-fg-muted text-xs">{relativeTime(d.lastSeenAt, now)}</td>
                    <td className="py-2.5 pr-3 min-w-[16rem]">
                      <DeviceIpCell
                        device={d}
                        keepsPunches={keepsPunches}
                        canApprove={canApprove}
                        onAllow={(device, request) => setAllowing({ device, request })}
                        onReject={(device, request) => setRejecting({ device, request })}
                      />
                    </td>
                    <td className="py-2.5">
                      <Badge tone={online ? 'success' : 'neutral'}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${online ? 'bg-success animate-pulse' : 'bg-fg-subtle'}`} />
                        {online ? 'Connected' : 'Offline'}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {isAdmin ? (
                        <button
                          type="button"
                          title="Add punches from the machine's file (USB)"
                          onClick={() => setImporting(d)}
                          className="p-1.5 rounded-md text-fg-subtle hover:bg-primary/10 hover:text-primary"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
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
      {importing ? <ImportPunchesModal device={importing} onClose={() => setImporting(null)} /> : null}
      <ConfirmDialog
        open={Boolean(allowing)}
        onClose={() => setAllowing(null)}
        onConfirm={confirmAllow}
        loading={allowNewIp.isPending}
        tone="warning"
        title="Approve this new IP?"
        message={allowMessage()}
        confirmLabel="Approve"
      />
      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={confirmReject}
        loading={rejectNewIp.isPending}
        tone="warning"
        title="Reject this new IP?"
        message={rejectMessage()}
        confirmLabel="Reject"
      />
    </Card>
    <IpApproversCard keepsPunches={keepsPunches} />
    </>
  );
}
