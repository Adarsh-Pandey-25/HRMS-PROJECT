import { useMemo, useState, useEffect } from 'react';
import { Plus, Clock, Check, UserPen } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, StatusBadge, Modal, Input, Textarea,
  EmptyState, Skeleton, Avatar, Select,
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

function HrRegularization() {
  const { data: tickets = [], isLoading } = useAllTickets();
  const { updateStatus } = useHelpdeskMutations();
  const { manualEntry } = useAttendanceMutations();
  const { employees } = useEmployees();
  const employeeMap = useEmployeeMap();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInitial, setManualInitial] = useState(null);
  const [activeTicketId, setActiveTicketId] = useState(null);

  const allRequests = useMemo(
    () => tickets.filter(isRegularizationTicket).map(parseRegularizationTicket).filter(Boolean),
    [tickets],
  );

  const pending = useMemo(
    () => allRequests.filter((r) => PENDING_STATUSES.has(r.status)),
    [allRequests],
  );

  const resolved = useMemo(
    () => allRequests.filter((r) => !PENDING_STATUSES.has(r.status)),
    [allRequests],
  );

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

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Regularization"
        subtitle="Review employee correction requests and apply manual attendance entries"
        actions={<Button icon={UserPen} variant="outline" onClick={() => openManual()}>Manual entry</Button>}
      />

      <Card>
        <CardHeader title="Pending requests" subtitle={`${pending.length} waiting for HR action`} />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : pending.length === 0 ? (
            <EmptyState icon={Clock} title="No pending requests" message="Employee regularization requests will appear here for review." />
          ) : (
            pending.map((row) => {
              const emp = employeeMap[row.employeeId];
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
                  <StatusBadge status={row.status} />
                  <Button size="sm" icon={Check} onClick={() => openManual(row)} loading={manualEntry.isPending}>
                    Apply correction
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {resolved.length > 0 && (
        <Card>
          <CardHeader title="Processed" subtitle={`${resolved.length} resolved or closed`} />
          <div className="p-5 pt-3">
            <RequestList
              rows={resolved}
              loading={false}
              emptyTitle=""
              emptyMessage=""
              employeeMap={employeeMap}
              showEmployee
            />
          </div>
        </Card>
      )}

      <HrManualEntryModal
        open={manualOpen}
        onClose={() => { setManualOpen(false); setActiveTicketId(null); setManualInitial(null); }}
        initial={manualInitial}
        employees={employees}
        onSubmit={applyManual}
        loading={manualEntry.isPending || updateStatus.isPending}
      />
    </div>
  );
}

export default function Regularization() {
  const role = useAuthStore((s) => s.role);
  const isHrAdmin = role === 'admin' || role === 'hr';
  return isHrAdmin ? <HrRegularization /> : <EmployeeRegularization />;
}
