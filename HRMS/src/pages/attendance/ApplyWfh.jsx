import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Home } from 'lucide-react';
import { PageHeader, Card, Button, Textarea, DateRangePicker } from '../../components/ui';
import { useAttendanceMutations } from '../../hooks/useAttendance';
import { daysBetween } from '../../lib/utils';
import toast from 'react-hot-toast';

/** Longest range the server accepts (wfhRequest.service MAX_RANGE_DAYS). */
const MAX_RANGE_DAYS = 90;

/** Today in the browser's local date, as the YYYY-MM-DD a date input wants. */
const todayStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function ApplyWfh() {
  const navigate = useNavigate();
  const { requestWfh } = useAttendanceMutations();
  const today = todayStr();
  const [form, setForm] = useState({ from: today, to: today, reason: '' });

  const days = form.from && form.to ? daysBetween(form.from, form.to) : 0;
  const rangeTooLong = days > MAX_RANGE_DAYS;
  const endsBeforeStart = Boolean(form.from && form.to && form.to < form.from);
  const startsInPast = Boolean(form.from && form.from < today);

  const submit = async () => {
    if (!form.from || !form.to) return toast.error('Pick the dates you want to work from home');
    if (startsInPast) return toast.error('You cannot request WFH for a past date');
    if (endsBeforeStart) return toast.error('End date cannot be before start date');
    if (rangeTooLong) return toast.error(`A WFH request can span at most ${MAX_RANGE_DAYS} days`);
    if (!form.reason.trim()) return toast.error('Please add a reason');

    try {
      await requestWfh.mutateAsync({ from: form.from, to: form.to, reason: form.reason.trim() });
      toast.success(
        days > 1
          ? `WFH requested for ${days} days — waiting for Manager/HR approval`
          : 'WFH requested — waiting for Manager/HR approval',
      );
      navigate('/attendance/wfh');
    } catch (err) {
      toast.error(err.message || 'Failed to submit WFH request');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button
        type="button"
        onClick={() => navigate('/attendance/wfh')}
        className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to My WFH
      </button>

      <PageHeader title="Apply for Work From Home" subtitle="Pick the dates you want to work from home" />

      <Card className="p-6">
        <div className="space-y-4">
          <DateRangePicker
            label="Dates"
            required
            from={form.from}
            to={form.to}
            min={today}
            onFromChange={(v) => setForm((f) => ({ ...f, from: v, to: f.to && f.to < v ? v : f.to }))}
            onToChange={(v) => setForm((f) => ({ ...f, to: v }))}
          />

          {days > 0 && !endsBeforeStart && (
            <p className={rangeTooLong ? 'text-xs font-medium text-danger' : 'text-xs font-medium text-primary'}>
              {rangeTooLong
                ? `${days} days selected — the maximum is ${MAX_RANGE_DAYS}`
                : `${days} day${days > 1 ? 's' : ''} selected`}
            </p>
          )}

          <Textarea
            label="Reason"
            required
            rows={3}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="Briefly describe why you need to work from home..."
          />

          <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-background px-3 py-2.5">
            <Home className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-fg-subtle">
              Your Manager (or HR, if you have no manager assigned) reviews this request.
              Once approved, you can clock in from any network on those days.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-5 border-t border-border/60">
          <Button variant="outline" onClick={() => navigate('/attendance/wfh')}>Cancel</Button>
          <Button
            icon={Send}
            onClick={submit}
            loading={requestWfh.isPending}
            disabled={requestWfh.isPending || rangeTooLong || endsBeforeStart || startsInPast}
          >
            Submit Request
          </Button>
        </div>
      </Card>
    </div>
  );
}
