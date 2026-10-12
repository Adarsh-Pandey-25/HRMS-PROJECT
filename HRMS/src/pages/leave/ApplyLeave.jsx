import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { PageHeader, Card, Button, Select, Textarea, DateRangePicker, Skeleton } from '../../components/ui';
import { useLeaveMutations, useLeaveTypes } from '../../hooks/useLeaves';
import { leaveTypeLabel } from '../../lib/mappers';
import { fetchLeaveDayCountApi } from '../../api/leaves.api';
import { formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function ApplyLeave() {
  const navigate = useNavigate();
  const { apply } = useLeaveMutations();
  const { data: leaveTypes, isLoading } = useLeaveTypes();
  const [form, setForm] = useState({ type: '', from: '', to: '', reason: '' });
  // What the server will charge: weekly offs and holidays in the range are free.
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!form.from || !form.to || form.to < form.from) { setCount(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      fetchLeaveDayCountApi({ from: form.from, to: form.to })
        .then((c) => { if (alive) setCount(c); })
        .catch(() => { if (alive) setCount(null); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [form.from, form.to]);
  const freeDays = count?.excluded || [];

  const typeOptions = useMemo(() => {
    const rows = Array.isArray(leaveTypes) ? leaveTypes : leaveTypes?.types || [];
    if (!rows.length) {
      return [
        { value: 'CL', label: 'Casual Leave' },
        { value: 'SL', label: 'Sick Leave' },
        { value: 'EL', label: 'Earned Leave' },
        { value: 'WFH', label: 'Work From Home' },
        { value: 'UNPAID', label: 'Unpaid Leave' },
      ];
    }
    return rows
      .filter((t) => t.active !== false)
      .map((t) => {
        const code = String(t.code || t.leave_type || t.leaveType || '').toUpperCase();
        return { value: code, label: t.name || leaveTypeLabel(code) };
      })
      .filter((o) => o.value);
  }, [leaveTypes]);

  const submit = async () => {
    const type = form.type || typeOptions[0]?.value;
    if (!type || !form.from || !form.to || !form.reason) return toast.error('Please fill all fields');
    if (count && count.days === 0) return toast.error('Every day you picked is a weekly off or a holiday — no leave needed');
    try {
      await apply.mutateAsync({ ...form, type, leaveType: type });
      toast.success('Leave request submitted');
      navigate('/leave/me');
    } catch (err) {
      toast.error(err.message || 'Failed to submit leave');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button type="button" onClick={() => navigate('/leave/me')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to My Leave
      </button>

      <PageHeader title="Apply Leave" subtitle="Submit a new leave request" />

      <Card className="p-6">
        <div className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-10 rounded-input" />
          ) : (
            <Select
              label="Leave type"
              value={form.type || typeOptions[0]?.value}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              options={typeOptions}
            />
          )}
          <DateRangePicker
            label="Duration"
            from={form.from}
            to={form.to}
            onFromChange={(v) => setForm({ ...form, from: v })}
            onToChange={(v) => setForm({ ...form, to: v })}
          />
          {form.from && form.to && count && (
            <div className="rounded-xl bg-primary/5 px-3 py-2 text-xs">
              <p className="font-semibold text-primary">
                {count.days === 0
                  ? 'No leave needed — these are all weekly offs or holidays'
                  : `${count.days} day${count.days === 1 ? '' : 's'} of leave`}
              </p>
              {freeDays.length > 0 && (
                <p className="mt-0.5 text-fg-subtle">
                  Not counted: {freeDays.map((d) => `${formatDate(d.date, 'EEE d MMM')} (${d.reason === 'holiday' ? d.name : 'weekly off'})`).join(', ')}
                </p>
              )}
            </div>
          )}
          <Textarea
            label="Reason"
            rows={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Briefly describe the reason for leave..."
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-5 border-t border-border/60">
          <Button variant="outline" onClick={() => navigate('/leave/me')}>Cancel</Button>
          <Button icon={Send} onClick={submit} loading={apply.isPending}>Submit Request</Button>
        </div>
      </Card>
    </div>
  );
}
