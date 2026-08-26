import { useState } from 'react';
import { Video, CalendarPlus, ClipboardCheck } from 'lucide-react';
import { PageHeader, Card, CardHeader, Badge, EmptyState, Skeleton, Button, Modal, Input, Select, Textarea } from '../../components/ui';
import { useInterviews, useCandidates, useRecruitmentMutations } from '../../hooks/useModules';
import { INTERVIEW_MODE_OPTIONS, INTERVIEW_STATUS_OPTIONS } from '../../api/recruitment.api';
import { formatDate, humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

const STATUS_TONE = { scheduled: 'info', completed: 'success', cancelled: 'neutral', 'no-show': 'danger' };

function ScheduleInterviewModal({ open, onClose, candidates }) {
  const { createInterview } = useRecruitmentMutations();
  const [form, setForm] = useState({ candidateId: '', interviewer: '', panel: '', mode: 'video', round: '1', scheduledAt: '' });

  const reset = () => setForm({ candidateId: '', interviewer: '', panel: '', mode: 'video', round: '1', scheduledAt: '' });
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!form.candidateId) return toast.error('Select a candidate');
    if (!form.interviewer.trim()) return toast.error('Interviewer name is required');
    if (!form.scheduledAt) return toast.error('Pick a date and time');
    const round = Number(form.round);
    if (!Number.isFinite(round) || round < 1) return toast.error('Round must be at least 1');

    try {
      await createInterview.mutateAsync({
        candidateId: form.candidateId,
        interviewer: form.interviewer.trim(),
        panel: form.panel.trim() || undefined,
        mode: form.mode,
        round,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
      });
      toast.success('Interview scheduled');
      close();
    } catch (err) {
      toast.error(err.message || 'Failed to schedule interview');
    }
  };

  return (
    <Modal
      open={open}
      onClose={createInterview.isPending ? undefined : close}
      title="Schedule Interview"
      subtitle="Set up an interview round for a candidate"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={createInterview.isPending}>Cancel</Button>
          <Button icon={CalendarPlus} onClick={submit} loading={createInterview.isPending} disabled={createInterview.isPending}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Candidate"
          required
          placeholder="Select a candidate"
          value={form.candidateId}
          onChange={(e) => setForm({ ...form, candidateId: e.target.value })}
          options={candidates.map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Interviewer" required placeholder="e.g. Rohan Mehta" value={form.interviewer} onChange={(e) => setForm({ ...form, interviewer: e.target.value })} />
          <Select
            label="Mode"
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value })}
            options={INTERVIEW_MODE_OPTIONS}
          />
          <Input label="Round" type="number" min="1" value={form.round} onChange={(e) => setForm({ ...form, round: e.target.value })} />
          <Input label="Scheduled at" required type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
        </div>
        <Input label="Panel (other interviewers)" placeholder="e.g. Anita Rao, Deepak Iyer" value={form.panel} onChange={(e) => setForm({ ...form, panel: e.target.value })} hint="Comma-separated, in addition to the primary interviewer" />
      </div>
    </Modal>
  );
}

function OutcomeModal({ interview, onClose }) {
  const { updateInterviewOutcome } = useRecruitmentMutations();
  const [status, setStatus] = useState(interview?.status || 'scheduled');
  const [feedback, setFeedback] = useState(interview?.feedback || '');

  const submit = async () => {
    try {
      await updateInterviewOutcome.mutateAsync({ id: interview.id, status, feedback: feedback.trim() || undefined });
      toast.success('Interview updated');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to update interview');
    }
  };

  return (
    <Modal
      open={!!interview}
      onClose={updateInterviewOutcome.isPending ? undefined : onClose}
      title="Record Outcome"
      subtitle={interview ? `${interview.interviewer || 'Interviewer'} · Round ${interview.round || 1}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={updateInterviewOutcome.isPending}>Cancel</Button>
          <Button icon={ClipboardCheck} onClick={submit} loading={updateInterviewOutcome.isPending} disabled={updateInterviewOutcome.isPending}>
            Save
          </Button>
        </>
      }
    >
      {interview && (
        <div className="space-y-4">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={INTERVIEW_STATUS_OPTIONS} />
          <Textarea label="Feedback" rows={4} placeholder="Interview notes and feedback..." value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

export default function Interviews() {
  const { data: interviews = [], isLoading } = useInterviews();
  const { data: candidates = [] } = useCandidates();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState(null);

  const candidateName = (iv) => candidates.find((c) => c.id === (iv.candidateId || iv.candidate_id))?.name || 'Candidate';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Interviews"
        subtitle="Scheduled interviews across all candidates"
        actions={<Button icon={CalendarPlus} onClick={() => setScheduleOpen(true)}>Schedule Interview</Button>}
      />

      <Card>
        <CardHeader title="Scheduled Interviews" subtitle="Click a row to record its outcome" />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          ) : interviews.length === 0 ? (
            <EmptyState icon={Video} title="No interviews" message="Scheduled interviews will appear here." />
          ) : interviews.map((iv) => {
            const when = iv.scheduledAt || iv.scheduled_at;
            const status = iv.status || 'scheduled';
            return (
              <button
                type="button"
                key={iv.id}
                onClick={() => setOutcomeFor(iv)}
                className="w-full flex items-center gap-4 rounded-xl border border-border/60 p-3 text-left hover:bg-muted/40 hover:border-primary/40 transition-colors"
              >
                <div className="flex flex-col items-center justify-center h-12 w-12 rounded-lg bg-primary/10 text-primary shrink-0">
                  <span className="text-[10px] uppercase font-semibold">{when ? formatDate(when, 'MMM') : '—'}</span>
                  <span className="text-base font-semibold leading-none">{when ? formatDate(when, 'dd') : '—'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg truncate">{candidateName(iv)}</p>
                  <p className="text-xs text-fg-subtle">
                    {iv.interviewer || 'Interviewer TBD'} · Round {iv.round || 1} · {humanize(iv.mode || 'video')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Badge tone={STATUS_TONE[status] || 'neutral'}>
                    <Video className="h-3 w-3" />
                    {humanize(status)}
                  </Badge>
                  <p className="text-xs text-fg-subtle mt-1">{when ? formatDate(when, 'hh:mm a') : '—'}</p>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <ScheduleInterviewModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} candidates={candidates} />
      <OutcomeModal interview={outcomeFor} onClose={() => setOutcomeFor(null)} />
    </div>
  );
}
