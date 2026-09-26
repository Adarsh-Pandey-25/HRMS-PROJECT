import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, TrendingUp, CalendarClock, Scale } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, CardHeader, Button, Avatar, Badge, Modal, Select, Input, Textarea,
  SegmentedControl, ConfirmDialog, EmptyState, Skeleton,
} from '../../components/ui';
import { useEmployees } from '../../hooks/useEmployees';
import { fetchEmployeeByIdApi } from '../../api/employees.api';
import {
  fetchSalaryRevisionsApi,
  createSalaryRevisionApi,
  cancelSalaryRevisionApi,
} from '../../api/payroll.api';
import { formatCurrency, formatDate } from '../../lib/utils';

/** Monthly earning components — must match SALARY_COMPONENTS in salaryRevision.service.js. */
const COMPONENTS = [
  { key: 'basic', label: 'Basic' },
  { key: 'hra', label: 'HRA' },
  { key: 'da', label: 'DA' },
  { key: 'special', label: 'Special allowance' },
  { key: 'transport', label: 'Transport allowance' },
  { key: 'medical', label: 'Medical allowance' },
];

const STATUS_TONE = { applied: 'success', scheduled: 'warning', cancelled: 'neutral' };
const STATUS_LABEL = { applied: 'Applied', scheduled: 'Scheduled', cancelled: 'Cancelled' };

const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const gross = (c) => COMPONENTS.reduce((s, { key }) => s + Number(c?.[key] || 0), 0);
const emptyComponents = () => Object.fromEntries(COMPONENTS.map(({ key }) => [key, '']));
const fullName = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim();

const pctChange = (from, to) => {
  if (!from) return null;
  return ((to - from) / from) * 100;
};

function ChangeText({ from, to }) {
  const pct = pctChange(from, to);
  if (pct == null) return null;
  const up = pct >= 0;
  return <span className={up ? 'text-success' : 'text-danger'}>({up ? '+' : ''}{pct.toFixed(1)}%)</span>;
}

/**
 * Scale the current structure proportionally to a new annual CTC, keeping
 * whole rupees; the rounding remainder goes to the largest component.
 */
function scaleToAnnual(current, annual) {
  const currentGross = gross(current);
  const targetMonthly = Math.round(Number(annual) / 12);
  if (!currentGross || !targetMonthly) return null;
  const factor = targetMonthly / currentGross;
  const scaled = Object.fromEntries(COMPONENTS.map(({ key }) => [key, Math.round(Number(current[key] || 0) * factor)]));
  const largest = COMPONENTS.reduce((a, b) => (Number(scaled[b.key]) > Number(scaled[a.key]) ? b : a)).key;
  scaled[largest] += targetMonthly - gross(scaled);
  return Object.fromEntries(Object.entries(scaled).map(([k, v]) => [k, String(v)]));
}

function RevisionModal({ open, onClose, employeeOptions }) {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [components, setComponents] = useState(emptyComponents);
  const [effectiveDate, setEffectiveDate] = useState(todayIst);
  const [reason, setReason] = useState('');
  const [targetCtc, setTargetCtc] = useState('');

  // The roster endpoint never returns salaries, so load the chosen employee's record.
  const { data: employee, isFetching: loadingEmployee } = useQuery({
    queryKey: ['salary-revision-employee', employeeId],
    queryFn: () => fetchEmployeeByIdApi(employeeId),
    enabled: open && Boolean(employeeId),
  });
  const current = useMemo(
    () => Object.fromEntries(COMPONENTS.map(({ key }) => [key, Number(employee?.salary?.[key] || 0)])),
    [employee],
  );

  useEffect(() => {
    if (employee) setComponents(Object.fromEntries(COMPONENTS.map(({ key }) => [key, String(current[key] || '')])));
  }, [employee, current]);

  useEffect(() => {
    if (!open) {
      setEmployeeId('');
      setComponents(emptyComponents());
      setEffectiveDate(todayIst());
      setReason('');
      setTargetCtc('');
    }
  }, [open]);

  const currentGross = gross(current);
  const newGross = gross(components);
  const isFuture = effectiveDate > todayIst();

  const create = useMutation({
    mutationFn: createSalaryRevisionApi,
    onSuccess: (rev) => {
      toast.success(rev?.status === 'applied' ? 'Salary updated' : `Revision scheduled for ${formatDate(rev?.effective_date)}`);
      qc.invalidateQueries({ queryKey: ['salary-revisions'] });
      qc.invalidateQueries({ queryKey: ['salary-revision-employee', employeeId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    },
    onError: (err) => toast.error(err.message || 'Could not save the revision'),
  });

  const applyScale = () => {
    const scaled = scaleToAnnual(current, targetCtc);
    if (!scaled) return toast.error('Enter a new annual CTC to scale the current structure');
    setComponents(scaled);
  };

  const submit = () => {
    if (!employeeId) return toast.error('Select an employee');
    if (!Number(components.basic)) return toast.error('Basic salary must be greater than zero');
    if (!effectiveDate) return toast.error('Choose an effective date');
    create.mutate({
      employeeId,
      components: Object.fromEntries(COMPONENTS.map(({ key }) => [key, Number(components[key] || 0)])),
      effectiveDate,
      reason: reason.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New salary revision"
      subtitle="Amounts are monthly. Payroll uses the new structure from the effective date."
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button icon={isFuture ? CalendarClock : TrendingUp} onClick={submit} loading={create.isPending} disabled={!employee}>
            {isFuture ? 'Schedule revision' : 'Apply now'}
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <Select
          label="Employee"
          placeholder="Select employee"
          options={employeeOptions}
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        />

        {employeeId && loadingEmployee && !employee && <Skeleton className="h-40 w-full" />}

        {employee && (
          <>
            <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
              <span className="text-fg-muted">Current monthly gross: </span>
              <span className="font-semibold text-fg">{formatCurrency(currentGross)}</span>
              <span className="text-fg-subtle"> · {formatCurrency(currentGross * 12)} / year</span>
            </div>

            {currentGross > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <Input
                  label="Scale current structure to a new annual CTC (optional)"
                  type="number"
                  min="0"
                  placeholder="e.g. 900000"
                  value={targetCtc}
                  onChange={(e) => setTargetCtc(e.target.value)}
                  containerClass="flex-1"
                />
                <Button variant="secondary" icon={Scale} onClick={applyScale}>Scale</Button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {COMPONENTS.map(({ key, label }) => (
                <Input
                  key={key}
                  label={label}
                  type="number"
                  min="0"
                  required={key === 'basic'}
                  value={components[key]}
                  hint={current[key] ? `Now ${formatCurrency(current[key])}` : undefined}
                  onChange={(e) => setComponents((c) => ({ ...c, [key]: e.target.value }))}
                />
              ))}
            </div>

            <div className="rounded-xl border border-border/60 px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-2">
              <span className="text-fg-muted">New monthly gross:</span>
              <span className="font-semibold text-fg">{formatCurrency(newGross)}</span>
              <span className="text-fg-subtle">· {formatCurrency(newGross * 12)} / year</span>
              <ChangeText from={currentGross} to={newGross} />
            </div>

            <Input
              label="Effective date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              hint={isFuture ? 'Applied automatically on this date' : 'Applied as soon as you save'}
            />
            <Textarea label="Reason" rows={2} placeholder="e.g. Annual appraisal 2026" value={reason} onChange={(e) => setReason(e.target.value)} />
          </>
        )}
      </div>
    </Modal>
  );
}

export default function SalaryRevisions() {
  const qc = useQueryClient();
  const { employees } = useEmployees();
  const [modal, setModal] = useState(false);
  const [status, setStatus] = useState('all');
  const [toCancel, setToCancel] = useState(null);

  const { data: revisions = [], isLoading } = useQuery({
    queryKey: ['salary-revisions', status],
    queryFn: () => fetchSalaryRevisionsApi(status === 'all' ? {} : { status }),
  });

  const cancel = useMutation({
    mutationFn: cancelSalaryRevisionApi,
    onSuccess: () => {
      toast.success('Revision cancelled');
      qc.invalidateQueries({ queryKey: ['salary-revisions'] });
      setToCancel(null);
    },
    onError: (err) => toast.error(err.message || 'Could not cancel the revision'),
  });

  const employeeOptions = employees
    .filter((e) => e.status === 'active')
    .map((e) => ({ value: e.id, label: `${e.name}${e.designation ? ` · ${e.designation}` : ''}` }));
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Salary Revisions"
        subtitle="Change an employee's salary structure with an effective date and reason"
        actions={<Button icon={Plus} onClick={() => setModal(true)}>New revision</Button>}
      />

      <Card>
        <CardHeader
          title="Revision history"
          subtitle={isLoading ? 'Loading…' : `${revisions.length} ${revisions.length === 1 ? 'revision' : 'revisions'}`}
          action={(
            <SegmentedControl
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'applied', label: 'Applied' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          )}
        />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : revisions.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="No salary revisions yet"
              message="Revisions you create are kept here with who made them and when they take effect."
              action={<Button icon={Plus} onClick={() => setModal(true)}>New revision</Button>}
            />
          ) : revisions.map((r) => {
            const name = fullName(r.employee) || 'Former employee';
            const from = Number(r.previous_monthly_gross || 0);
            const to = Number(r.new_monthly_gross || 0);
            return (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar employee={employeeById.get(r.employee_id)} name={name} size="md" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-fg">
                      {name}
                      {r.employee?.designation && <span className="text-fg-subtle font-normal"> · {r.employee.designation}</span>}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {formatCurrency(from)} → <span className="font-medium text-fg">{formatCurrency(to)}</span> / month{' '}
                      <ChangeText from={from} to={to} />
                    </p>
                    <p className="text-xs text-fg-subtle truncate">
                      Effective {formatDate(r.effective_date)}
                      {r.reason && ` · ${r.reason}`}
                      {r.creator && ` · by ${fullName(r.creator)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <Badge tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status] || r.status}</Badge>
                  {r.status === 'scheduled' && (
                    <Button size="sm" variant="ghost" onClick={() => setToCancel(r)}>Cancel</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <RevisionModal open={modal} onClose={() => setModal(false)} employeeOptions={employeeOptions} />

      <ConfirmDialog
        open={Boolean(toCancel)}
        onClose={() => setToCancel(null)}
        onConfirm={() => cancel.mutate(toCancel.id)}
        loading={cancel.isPending}
        title="Cancel this revision?"
        message={toCancel ? `${fullName(toCancel.employee)}'s salary will stay as it is. The scheduled change for ${formatDate(toCancel.effective_date)} won't be applied.` : ''}
        confirmLabel="Cancel revision"
        cancelLabel="Keep it"
      />
    </div>
  );
}
