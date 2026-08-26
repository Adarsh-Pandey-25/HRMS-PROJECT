import { useState } from 'react';
import { Star, Clock, Mail, Phone, Briefcase, CalendarClock, Send, X, UserPlus, FileText } from 'lucide-react';
import { PageHeader, Card, Avatar, StatusBadge, Badge, Button, Drawer, Skeleton, Modal, Input, Select, Textarea, FileUpload } from '../../components/ui';
import { KanbanBoard } from '../../components/shared/KanbanBoard';
import { KANBAN_STAGES } from '../../data';
import { useCandidates, useJobs, useRecruitmentMutations } from '../../hooks/useModules';
import { useSettingsStore } from '../../store/settingsStore';
import { CANDIDATE_SOURCE_OPTIONS, openCandidateResumeApi } from '../../api/recruitment.api';
import { formatDate, humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

const SOURCE_TONE = {
  referral: 'success', 'job-board': 'primary', linkedin: 'info', direct: 'warning', other: 'neutral',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toStageId = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '-');

function pipelineColumns(stages) {
  const labels = (Array.isArray(stages) ? stages : [])
    .map((s) => String(s).trim())
    .filter((s) => s && toStageId(s) !== 'rejected');
  if (!labels.length) return KANBAN_STAGES;
  return labels.map((label) => ({ id: toStageId(label), label }));
}

function CandidateCard({ c }) {
  return (
    <div className="rounded-xl bg-card border border-border/70 p-3 shadow-sm hover:shadow-card transition-shadow">
      <div className="flex items-center gap-2.5">
        <Avatar name={c.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg truncate">{c.name}</p>
          <p className="text-xs text-fg-subtle">{c.experience ? `${c.experience}y exp` : c.email}</p>
        </div>
      </div>
      {c.source && (
        <div className="mt-2.5 flex items-center justify-between">
          <Badge tone={SOURCE_TONE[c.source] || 'neutral'}>{humanize(c.source)}</Badge>
          {c.rating != null && (
            <div className="flex items-center gap-0.5 text-warning">
              <Star className="h-3.5 w-3.5 fill-current" />
              <span className="text-xs font-medium text-fg">{c.rating}</span>
            </div>
          )}
        </div>
      )}
      <p className="mt-2 flex items-center gap-1 text-[11px] text-fg-subtle">
        <Clock className="h-3 w-3" /> {c.daysInStage}d in stage
      </p>
    </div>
  );
}

function AddCandidateModal({ open, onClose, jobs }) {
  const { createCandidate } = useRecruitmentMutations();
  const [form, setForm] = useState({ name: '', email: '', phone: '', jobId: '', source: '' });
  const [resume, setResume] = useState(null);

  const reset = () => {
    setForm({ name: '', email: '', phone: '', jobId: '', source: '' });
    setResume(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!form.name.trim()) return toast.error('Candidate name is required');
    if (!EMAIL_RE.test(form.email.trim())) return toast.error('Enter a valid email address');
    try {
      await createCandidate.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        jobId: form.jobId || undefined,
        source: form.source || undefined,
        resume: resume || undefined,
      });
      toast.success(`${form.name.trim()} added to the pipeline`);
      close();
    } catch (err) {
      toast.error(err.message || 'Failed to add candidate');
    }
  };

  return (
    <Modal
      open={open}
      onClose={createCandidate.isPending ? undefined : close}
      title="Add Candidate"
      subtitle="Add a new applicant to the pipeline"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={createCandidate.isPending}>Cancel</Button>
          <Button icon={UserPlus} onClick={submit} loading={createCandidate.isPending} disabled={createCandidate.isPending}>
            Add Candidate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Full name" required placeholder="e.g. Priya Sharma" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" required type="email" placeholder="priya@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" placeholder="e.g. 98765 43210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select
            label="Applying for"
            placeholder="Select a job opening"
            value={form.jobId}
            onChange={(e) => setForm({ ...form, jobId: e.target.value })}
            options={jobs.map((j) => ({ value: j.id, label: j.title }))}
          />
          <Select
            label="Source"
            placeholder="How did they apply?"
            containerClass="sm:col-span-2"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            options={CANDIDATE_SOURCE_OPTIONS}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-fg-muted mb-1.5 block">Resume</label>
          <FileUpload
            accept=".pdf,.doc,.docx"
            multiple={false}
            hint="PDF, DOC or DOCX · up to 5MB"
            onChange={(files) => setResume(files?.[0] || null)}
          />
        </div>
      </div>
    </Modal>
  );
}

function SendOfferModal({ candidate, onClose, onSuccess }) {
  const { createOffer } = useRecruitmentMutations();
  const [form, setForm] = useState({ amount: '', currency: 'INR', designation: '', joiningDate: '', notes: '' });

  const submit = async () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid offer amount');
    try {
      await createOffer.mutateAsync({
        candidateId: candidate.id,
        amount,
        currency: form.currency || 'INR',
        designation: form.designation.trim() || undefined,
        joiningDate: form.joiningDate || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success(`Offer created for ${candidate.name}`);
      onSuccess ? onSuccess() : onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to create offer');
    }
  };

  return (
    <Modal
      open={!!candidate}
      onClose={createOffer.isPending ? undefined : onClose}
      title="Send Offer"
      subtitle={candidate ? `Create and record an offer for ${candidate.name}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={createOffer.isPending}>Cancel</Button>
          <Button icon={Send} onClick={submit} loading={createOffer.isPending} disabled={createOffer.isPending}>
            Send Offer
          </Button>
        </>
      }
    >
      {candidate && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Amount (CTC)" required type="number" min="0" placeholder="e.g. 1200000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Select
              label="Currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }, { value: 'EUR', label: 'EUR' }, { value: 'GBP', label: 'GBP' }]}
            />
            <Input label="Designation" placeholder="e.g. Senior React Developer" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            <Input label="Joining date" type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} />
          </div>
          <Textarea label="Notes" rows={2} placeholder="Any notes for this offer..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      )}
    </Modal>
  );
}

export default function Candidates() {
  const { data: candidates = [], isLoading } = useCandidates();
  const { data: jobs = [] } = useJobs();
  const { moveCandidate } = useRecruitmentMutations();
  const recruitmentStages = useSettingsStore((s) => s.recruitmentConfig?.stages);
  const columns = pipelineColumns(recruitmentStages);
  const [selected, setSelected] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [offerFor, setOfferFor] = useState(null);

  const handleMove = async (id, stage) => {
    const c = candidates.find((x) => x.id === id);
    try {
      await moveCandidate.mutateAsync({ id, stage });
      toast.success(`${c?.name} → ${humanize(stage)}`);
    } catch (err) {
      toast.error(err.message || 'Failed to move candidate');
    }
  };

  const jobTitle = selected ? jobs.find((j) => j.id === selected.jobId)?.title : null;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Candidates"
        subtitle="Applicant pipeline across all open roles"
        actions={<Button icon={UserPlus} onClick={() => setAddOpen(true)}>Add Candidate</Button>}
      />

      <Card className="p-4">
        <p className="text-xs text-fg-subtle mb-3">Drag candidates between stages to update their status.</p>
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          <KanbanBoard
            columns={columns}
            items={candidates.filter((c) => c.stage !== 'rejected')}
            onMove={handleMove}
            onCardClick={setSelected}
            renderCard={(c) => <CandidateCard c={c} />}
          />
        )}
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={jobTitle}
        footer={
          selected && (
            <>
              <Button variant="danger-ghost" icon={X} onClick={() => { handleMove(selected.id, 'rejected'); setSelected(null); }}>Reject</Button>
              <Button icon={Send} onClick={() => setOfferFor(selected)}>Send Offer</Button>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar name={selected.name} size="lg" />
              <div>
                <StatusBadge status={selected.stage?.replace(/_/g, '-')} />
                <p className="text-sm text-fg-muted mt-1">Applied {selected.appliedOn ? formatDate(selected.appliedOn) : '—'}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {selected.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-fg-subtle" /> {selected.email}</p>}
              {selected.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-fg-subtle" /> {selected.phone}</p>}
              {jobTitle && <p className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-fg-subtle" /> {jobTitle}</p>}
              {selected.source && <p className="flex items-center gap-2"><Badge tone={SOURCE_TONE[selected.source] || 'neutral'}>{humanize(selected.source)}</Badge></p>}
              {selected.resumeUrl && (
                <button
                  type="button"
                  onClick={() => openCandidateResumeApi(selected.id).catch((err) => toast.error(err.message || 'Failed to open resume'))}
                  className="flex items-center gap-2 text-primary hover:underline"
                >
                  <FileText className="h-4 w-4" /> View resume
                </button>
              )}
              <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-fg-subtle" /> {selected.daysInStage} days in current stage</p>
            </div>
          </div>
        )}
      </Drawer>

      <AddCandidateModal open={addOpen} onClose={() => setAddOpen(false)} jobs={jobs} />
      <SendOfferModal
        candidate={offerFor}
        onClose={() => setOfferFor(null)}
        onSuccess={() => { setOfferFor(null); setSelected(null); }}
      />
    </div>
  );
}
