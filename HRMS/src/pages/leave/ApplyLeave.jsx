import { useMemo } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { PageHeader, Card, Button, Select, Textarea, DateRangePicker, Skeleton } from '../../components/ui';
import { useLeaveMutations, useLeaveTypes } from '../../hooks/useLeaves';
import { leaveTypeLabel } from '../../lib/mappers';
import { daysBetween } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function ApplyLeave() {
  const navigate = useNavigate();
  const { apply } = useLeaveMutations();
  const { data: leaveTypes, isLoading } = useLeaveTypes();
  const [form, setForm] = useState({ type: '', from: '', to: '', reason: '' });

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
          {form.from && form.to && (
            <p className="text-xs text-primary font-medium">{daysBetween(form.from, form.to)} day(s) selected</p>
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
