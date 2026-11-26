import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Save, Plus, Trash2, Globe } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, Input, Select, Textarea, Toggle, RichTextEditor, Skeleton, EmptyState,
} from '../../components/ui';
import { DEPARTMENTS } from '../../lib/constants';
import { useJobs, useRecruitmentMutations } from '../../hooks/useModules';
import toast from 'react-hot-toast';

const TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Internship' },
];
const WORK_MODE_OPTIONS = [
  { value: 'on_site', label: 'On site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
];
const CURRENCY_OPTIONS = ['INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD'].map((c) => ({ value: c, label: c }));
const PERIOD_OPTIONS = [{ value: 'year', label: 'per year' }, { value: 'month', label: 'per month' }];
const QUESTION_TYPE_OPTIONS = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'number', label: 'Number' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'select', label: 'Choose one' },
];
const MAX_QUESTIONS = 10;

const EMPTY = {
  title: '', department: '', location: '', type: 'full_time', openings: '1', status: 'open',
  workMode: '', summary: '', showOnWebsite: false, closesOn: '',
  experienceMin: '', experienceMax: '', salaryMin: '', salaryMax: '', salaryCurrency: 'INR', salaryPeriod: 'year', showSalary: false,
  skills: '',
};

const text = (v) => (v === null || v === undefined ? '' : String(v));

/** The form's state from a saved job. */
const fromJob = (j) => ({
  title: j.title || '',
  department: j.department || '',
  location: j.location || '',
  type: j.employmentType || 'full_time',
  openings: text(j.openings || 1),
  status: j.status === 'closed' ? 'closed' : 'open',
  workMode: j.workMode || '',
  summary: j.summary || '',
  showOnWebsite: Boolean(j.showOnWebsite),
  closesOn: j.closesOn ? String(j.closesOn).slice(0, 10) : '',
  experienceMin: text(j.experienceMin),
  experienceMax: text(j.experienceMax),
  salaryMin: text(j.salaryMin),
  salaryMax: text(j.salaryMax),
  salaryCurrency: j.salaryCurrency || 'INR',
  salaryPeriod: j.salaryPeriod || 'year',
  showSalary: Boolean(j.showSalary),
  skills: (j.skills || []).join(', '),
});

const questionsFromJob = (j) => (j.questions || []).map((q) => ({
  id: q.id, label: q.label || '', type: q.type || 'text', required: Boolean(q.required), options: (q.options || []).join(', '),
}));

/** "" → null, otherwise a number (NaN when it isn't one). */
const numberOrNull = (v) => (String(v).trim() === '' ? null : Number(v));

/**
 * Post a job, or edit one (/recruitment/jobs/:id/edit). "Show on website"
 * puts it on the company's own website through the Careers API, with the
 * details and extra questions entered here (Settings → Recruitment →
 * Careers website has the key and the websites).
 */
export default function AddJob() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { data: jobs = [], isLoading } = useJobs();
  const { createJob, updateJob } = useRecruitmentMutations();
  const existing = isEdit ? jobs.find((j) => j.id === id) : null;

  const [form, setForm] = useState(EMPTY);
  const [jd, setJd] = useState('');
  const [questions, setQuestions] = useState([]);
  const [loadedId, setLoadedId] = useState(null);

  useEffect(() => {
    if (existing && loadedId !== existing.id) {
      setForm(fromJob(existing));
      setJd(existing.description || '');
      setQuestions(questionsFromJob(existing));
      setLoadedId(existing.id);
    }
  }, [existing, loadedId]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setQuestion = (index, patch) => setQuestions((list) => list.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  const saving = createJob.isPending || updateJob.isPending;

  const save = async () => {
    if (!form.title.trim()) return toast.error('Job title is required');
    const openings = Number(form.openings);
    if (!Number.isInteger(openings) || openings < 1) return toast.error('Openings must be at least 1');
    const expMin = numberOrNull(form.experienceMin);
    const expMax = numberOrNull(form.experienceMax);
    const salMin = numberOrNull(form.salaryMin);
    const salMax = numberOrNull(form.salaryMax);
    if ([expMin, expMax, salMin, salMax].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
      return toast.error('Experience and salary must be numbers');
    }
    if (expMin !== null && expMax !== null && expMin > expMax) return toast.error('Experience: "from" can\'t be more than "to"');
    if (salMin !== null && salMax !== null && salMin > salMax) return toast.error('Salary: "from" can\'t be more than "to"');
    if (form.summary.length > 300) return toast.error('Keep the short summary under 300 characters');
    for (const [i, q] of questions.entries()) {
      if (!q.label.trim()) return toast.error(`Question ${i + 1} needs a question`);
      if (q.type === 'select' && q.options.split(',').map((o) => o.trim()).filter(Boolean).length < 2) {
        return toast.error(`Question ${i + 1}: add at least two choices, separated by commas`);
      }
    }

    const payload = {
      title: form.title.trim(),
      department: form.department,
      location: form.location,
      employmentType: form.type,
      openings,
      description: jd,
      workMode: form.workMode || null,
      summary: form.summary.trim(),
      showOnWebsite: form.showOnWebsite,
      closesOn: form.closesOn || null,
      experienceMin: expMin,
      experienceMax: expMax,
      salaryMin: salMin,
      salaryMax: salMax,
      salaryCurrency: form.salaryCurrency,
      salaryPeriod: form.salaryPeriod,
      showSalary: form.showSalary,
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      questions: questions.map((q) => ({
        ...(q.id ? { id: q.id } : {}),
        label: q.label.trim(),
        type: q.type,
        required: q.required,
        ...(q.type === 'select' ? { options: q.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
      })),
    };

    try {
      if (isEdit) {
        await updateJob.mutateAsync({ id, ...payload, status: form.status });
        toast.success('Job saved');
      } else {
        await createJob.mutateAsync({ ...payload, status: 'open' });
        toast.success(form.showOnWebsite ? 'Job posted — it will show on your website within a minute' : 'Job posted successfully');
      }
      navigate('/recruitment/jobs');
    } catch (err) {
      toast.error(err.message || 'Failed to save the job');
    }
  };

  if (isEdit && isLoading) return <Skeleton className="h-96 w-full max-w-3xl mx-auto rounded-card" />;
  if (isEdit && !existing) {
    return <Card className="py-8 max-w-3xl mx-auto"><EmptyState title="Job not found" message="It may have been removed." /></Card>;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <button type="button" onClick={() => navigate('/recruitment/jobs')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Job Openings
      </button>

      <PageHeader title={isEdit ? 'Edit Job' : 'Post a New Job'} subtitle={isEdit ? existing.title : 'Create a new job opening'} />

      <Card className="p-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Job title" required placeholder="e.g. Senior React Developer" containerClass="sm:col-span-2" value={form.title} onChange={(e) => set({ title: e.target.value })} />
            <Select label="Department" options={DEPARTMENTS} placeholder="Select department" value={form.department} onChange={(e) => set({ department: e.target.value })} />
            <Input label="Location" placeholder="e.g. Sector 48, Gurgaon" value={form.location} onChange={(e) => set({ location: e.target.value })} />
            <Select label="Type" value={form.type} onChange={(e) => set({ type: e.target.value })} options={TYPE_OPTIONS} />
            <Select label="Work mode" placeholder="Select work mode" value={form.workMode} onChange={(e) => set({ workMode: e.target.value })} options={WORK_MODE_OPTIONS} />
            <Input label="Openings" type="number" min="1" value={form.openings} onChange={(e) => set({ openings: e.target.value })} />
            {isEdit && (
              <Select label="Status" value={form.status} onChange={(e) => set({ status: e.target.value })} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Input label="Experience from (years)" type="number" min="0" max="60" value={form.experienceMin} onChange={(e) => set({ experienceMin: e.target.value })} />
            <Input label="to (years)" type="number" min="0" max="60" value={form.experienceMax} onChange={(e) => set({ experienceMax: e.target.value })} />
            <Input label="Salary from" type="number" min="0" value={form.salaryMin} onChange={(e) => set({ salaryMin: e.target.value })} />
            <Input label="Salary to" type="number" min="0" value={form.salaryMax} onChange={(e) => set({ salaryMax: e.target.value })} />
            <Select label="Currency" value={form.salaryCurrency} onChange={(e) => set({ salaryCurrency: e.target.value })} options={CURRENCY_OPTIONS} />
            <Select label="Salary is" value={form.salaryPeriod} onChange={(e) => set({ salaryPeriod: e.target.value })} options={PERIOD_OPTIONS} />
          </div>
          <Input label="Skills" hint="Separate with commas, e.g. Sales, CPI, Negotiation" value={form.skills} onChange={(e) => set({ skills: e.target.value })} />
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Job description</label>
            <RichTextEditor value={jd} onChange={setJd} placeholder="Describe the role, responsibilities and requirements..." />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={<span className="inline-flex items-center gap-2"><Globe className="h-4 w-4" /> On your website</span>}
          subtitle="Shown on your company website through the Careers API (Settings → Recruitment → Careers website). Candidates apply there and appear in Candidates."
        />
        <div className="p-5 pt-3 space-y-4">
          <Toggle label="Show this job on our website" hint="Only while the job is open and before its closing date." checked={form.showOnWebsite} onChange={(v) => set({ showOnWebsite: v })} />
          <Textarea
            label="Short summary (shown in the job list)"
            rows={2}
            maxLength={300}
            placeholder="e.g. We are looking for strategic sales professionals to drive growth through brand partnerships."
            value={form.summary}
            onChange={(e) => set({ summary: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Closing date (optional)" type="date" value={form.closesOn} onChange={(e) => set({ closesOn: e.target.value })} />
            <div className="sm:pt-6">
              <Toggle label="Show the salary on the website" checked={form.showSalary} onChange={(v) => set({ showSalary: v })} />
            </div>
          </div>

          <div className="pt-2">
            <p className="text-xs font-medium text-fg-muted mb-2">Extra questions for this job (optional)</p>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div key={q.id || `new-${i}`} className="rounded-xl border border-border/70 p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <Input
                      label={`Question ${i + 1}`}
                      containerClass="flex-1"
                      maxLength={200}
                      placeholder="e.g. Are you comfortable working from our Gurgaon office?"
                      value={q.label}
                      onChange={(e) => setQuestion(i, { label: e.target.value })}
                    />
                    <button
                      type="button"
                      className="mt-7 p-1.5 text-fg-subtle hover:text-danger"
                      aria-label={`Remove question ${i + 1}`}
                      onClick={() => setQuestions((list) => list.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <Select label="Answer type" value={q.type} onChange={(e) => setQuestion(i, { type: e.target.value })} options={QUESTION_TYPE_OPTIONS} />
                    <Toggle label="Required" checked={q.required} onChange={(v) => setQuestion(i, { required: v })} />
                  </div>
                  {q.type === 'select' && (
                    <Input label="Choices" hint="Separate with commas, e.g. English, Hindi, Mandarin" value={q.options} onChange={(e) => setQuestion(i, { options: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
            {questions.length < MAX_QUESTIONS && (
              <Button
                variant="outline"
                size="sm"
                icon={Plus}
                className="mt-3"
                onClick={() => setQuestions((list) => [...list, { label: '', type: 'text', required: false, options: '' }])}
              >
                Add a question
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/recruitment/jobs')}>Cancel</Button>
        <Button icon={isEdit ? Save : Send} onClick={save} loading={saving} disabled={saving}>{isEdit ? 'Save Job' : 'Publish Job'}</Button>
      </div>
    </div>
  );
}
