import { useMemo, useState, useEffect } from 'react';
import { Plus, Clock, Check, X, UserPen } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, StatusBadge, Modal, Input, Textarea,
  EmptyState, Skeleton, Avatar, Select, Badge,
} from '../../components/ui';
import { useMyTickets, useAllTickets, useHelpdeskMutations } from '../../hooks/useModules';
import { useAttendanceMutations } from '../../hooks/useAttendance';
import { useEmployees, useEmployeeMap } from '../../hooks/useEmployees';
import { useAuthStore } from '../../store/authStore';
import {
  isRegularizationTicket,
  parseRegularizationTicket,
  buildRegularizationSubject,
  buildRegularizationDescription,
  toIstIso,
} from '../../lib/regularization';
import { formatDate, formatDateTime } from '../../lib/utils';
import toast from 'react-hot-toast';

const EMPTY_FORM = { date: '', requestedCheckIn: '', requestedCheckOut: '', reason: '' };
const EMPTY_MANUAL = { employeeId: '', date: '', checkIn: '', checkOut: '', remarks: '' };

const PENDING_STATUSES = new Set(['open', 'in_progress']);

function RequestList({ rows, loading, emptyTitle, emptyMessage, employeeMap, showEmployee }) {
  if (loading) return <Skeleton className="h-32 rounded-xl" />;
  if (rows.length === 0) {
    return <EmptyState icon={Clock} title={emptyTitle} message={emptyMessage} />;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const emp = showEmployee ? employeeMap[row.employeeId] : null;
        return (
          <div key={row.ticketId} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
            {showEmployee && emp ? (
              <Avatar name={emp.name} size="sm" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              {showEmployee && (
                <p className="text-sm font-medium text-fg">{emp?.name || 'Employee'}</p>
              )}
              <p className="text-sm font-medium text-fg">
                {formatDate(row.date)} · {row.requestedCheckIn}{row.requestedCheckOut ? `–${row.requestedCheckOut}` : ''}
              </p>
              <p className="text-xs text-fg-subtle truncate">{row.reason}</p>
              {row.createdAt && (
                <p className="text-[11px] text-fg-subtle mt-0.5">Submitted {formatDateTime(row.createdAt)}</p>
              )}
            </div>
            <StatusBadge status={row.status} />
          </div>
        );
      })}
    </div>
  );
}

function HrManualEntryModal({ open, onClose, initial, employees, onSubmit, loading }) {
  const [form, setForm] = useState(EMPTY_MANUAL);

  const employeeOptions = useMemo(
    () => employees
      .filter((e) => e.isActive !== false && e.role !== 'admin')
      .map((e) => ({ value: e.id, label: `${e.name || e.employeeCode} · ${e.department || '—'}` })),
    [employees],
  );

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_MANUAL, ...(initial || {}) });
  }, [open, initial]);

  const submit = async () => {
    if (!form.employeeId || !form.date || !form.checkIn) {
      return toast.error('Select employee, date, and check-in time');
    }
    await onSubmit({
      employeeId: form.employeeId,
      checkInTime: toIstIso(form.date, form.checkIn),
      checkOutTime: form.checkOut ? toIstIso(form.date, form.checkOut) : null,
      remarks: form.remarks?.trim() || undefined,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply attendance correction"
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={loading} icon={Check}>Save attendance</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Select
          label="Employee"
          options={[{ value: '', label: 'Select employee…' }, ...employeeOptions]}
          value={form.employeeId}
          onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
        />
        <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Check-in" type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
          <Input label="Check-out" type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
        </div>
        <Textarea label="Remarks" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
      </div>
    </Modal>
  );
}

function EmployeeRegularization() {
  const { data: tickets = [], isLoading } = useMyTickets();
  const { createTicket } = useHelpdeskMutations();
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const requests = useMemo(
    () => tickets.filter(isRegularizationTicket).map(parseRegularizationTicket).filter(Boolean),
    [tickets],
  );

  const submit = async () => {
    if (!form.date || !form.requestedCheckIn || !form.reason) {
      return toast.error('Please fill date, check-in time and reason');
    }
    try {
      await createTicket.mutateAsync({
        subject: buildRegularizationSubject(form.date),
        description: buildRegularizationDescription(form),
        category: 'hr',
        priority: 'medium',
      });
      setModal(false);
      setForm(EMPTY_FORM);
      toast.success('Correction request submitted — HR will review it');
    } catch (err) {
      toast.error(err.message || 'Failed to submit request');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Regularization"
        subtitle="Request corrections for a past day's attendance"
        actions={<Button icon={Plus} onClick={() => setModal(true)}>Request Correction</Button>}
      />
      <Card>
        <CardHeader title="My Requests" subtitle={`${requests.length} submitted`} />
        <div className="p-5 pt-3">
          <RequestList
            rows={requests}
            loading={isLoading}
            emptyTitle="No requests yet"
            emptyMessage="Submit a correction request when you forgot to check in or your attendance was recorded incorrectly."
          />
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Request Correction"
        footer={(
          <>
            <Button variant="outline" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={submit} loading={createTicket.isPending}>Submit Request</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Input label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Correct check-in" type="time" value={form.requestedCheckIn} onChange={(e) => setForm({ ...form, requestedCheckIn: e.target.value })} />
            <Input label="Correct check-out" type="time" value={form.requestedCheckOut} onChange={(e) => setForm({ ...form, requestedCheckOut: e.target.value })} />
          </div>
          <Textarea label="Reason" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

/** Item 2: reason is required — it's what regularizationRejectedEmail shows the employee. */
function RejectModal({ target, onClose, onConfirm, loading }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (target) setReason(''); }, [target]);
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title="Reject correction request"
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="text-danger" variant="outline" onClick={() => onConfirm(reason)} loading={loading} disabled={!reason.trim()}>
            Reject Request
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          The employee will be notified by email with this reason. This does not change their existing attendance record.
        </p>
        <Textarea label="Reason for rejection" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No supporting evidence for the requested correction" />
      </div>
    </Modal>
  );
}

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

function HrRegularization() {
  const { data: tickets = [], isLoading } = useAllTickets();
  const { updateStatus } = useHelpdeskMutations();
  const { manualEntry } = useAttendanceMutations();
  const { employees } = useEmployees();
  const employeeMap = useEmployeeMap();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInitial, setManualInitial] = useState(null);
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');

  const allRequests = useMemo(
    () => tickets.filter(isRegularizationTicket).map(parseRegularizationTicket).filter(Boolean),
    [tickets],
  );

  const pending = useMemo(
    () => allRequests.filter((r) => PENDING_STATUSES.has(r.status)),
    [allRequests],
  );

  // 'resolved' = approved-and-corrected; 'closed' = rejected — the closest
  // fit in the existing 4-status ticket model (open/in_progress/resolved/
  // closed), same mapping the reject flow below writes.
  const approved = useMemo(() => allRequests.filter((r) => r.status === 'resolved'), [allRequests]);
  const rejected = useMemo(() => allRequests.filter((r) => r.status === 'closed'), [allRequests]);

  const visibleRequests = statusFilter === 'all' ? allRequests
    : statusFilter === 'pending' ? pending
    : statusFilter === 'approved' ? approved
    : rejected;

  const openManual = (row = null) => {
    setActiveTicketId(row?.ticketId || null);
    setManualInitial(row ? {
      employeeId: row.employeeId,
      date: row.date,
      checkIn: row.requestedCheckIn,
      checkOut: row.requestedCheckOut,
      remarks: row.reason ? `Regularization: ${row.reason}` : 'Regularization correction',
    } : null);
    setManualOpen(true);
  };

  const applyManual = async ({ employeeId, checkInTime, checkOutTime, remarks }) => {
    try {
      await manualEntry.mutateAsync({
        employeeId,
        checkInTime,
        checkOutTime,
        remarks,
      });
      if (activeTicketId) {
        await updateStatus.mutateAsync({ id: activeTicketId, status: 'resolved' });
      }
      setManualOpen(false);
      setActiveTicketId(null);
      setManualInitial(null);
      toast.success('Attendance updated');
    } catch (err) {
      toast.error(err.message || 'Failed to apply correction');
    }
  };

  const confirmReject = async (reason) => {
    if (!reason.trim() || !rejectTarget) return;
    try {
      await updateStatus.mutateAsync({ id: rejectTarget.ticketId, status: 'closed', rejectionReason: reason.trim() });
      toast.success('Request rejected — employee notified by email');
      setRejectTarget(null);
    } catch (err) {
      toast.error(err.message || 'Failed to reject request');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Regularization"
        subtitle="Review employee correction requests and apply manual attendance entries"
        actions={<Button icon={UserPen} variant="outline" onClick={() => openManual()}>Manual entry</Button>}
      />

      <Card>
        <CardHeader
          title="Correction requests"
          subtitle={`${pending.length} pending · ${approved.length} approved · ${rejected.length} rejected`}
          action={(
            <div className="flex gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    statusFilter === f.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-fg-muted hover:border-fg-subtle'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : visibleRequests.length === 0 ? (
            <EmptyState icon={Clock} title="No requests" message="Employee regularization requests matching this filter will appear here." />
          ) : (
            visibleRequests.map((row) => {
              const emp = employeeMap[row.employeeId];
              const isPending = PENDING_STATUSES.has(row.status);
              return (
                <div key={row.ticketId} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
                  <Avatar name={emp?.name || 'Employee'} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg">{emp?.name || 'Employee'}</p>
                    <p className="text-xs text-fg-subtle">
                      {formatDate(row.date)} · {row.requestedCheckIn}{row.requestedCheckOut ? `–${row.requestedCheckOut}` : ''}
                    </p>
                    <p className="text-xs text-fg-muted truncate mt-0.5">{row.reason}</p>
                  </div>
                  {row.status === 'resolved' ? (
                    <Badge tone="success">Approved</Badge>
                  ) : row.status === 'closed' ? (
                    <Badge tone="danger">Rejected</Badge>
                  ) : (
                    <StatusBadge status={row.status} />
                  )}
                  {isPending && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="text-danger" icon={X} onClick={() => setRejectTarget(row)}>
                        Reject
                      </Button>
                      <Button size="sm" icon={Check} onClick={() => openManual(row)} loading={manualEntry.isPending}>
                        Apply correction
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      <HrManualEntryModal
        open={manualOpen}
        onClose={() => { setManualOpen(false); setActiveTicketId(null); setManualInitial(null); }}
        initial={manualInitial}
        employees={employees}
        onSubmit={applyManual}
        loading={manualEntry.isPending || updateStatus.isPending}
      />
      <RejectModal
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={confirmReject}
        loading={updateStatus.isPending}
      />
    </div>
  );
}

export default function Regularization() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  return isHrAdmin ? <HrRegularization /> : <EmployeeRegularization />;
}
