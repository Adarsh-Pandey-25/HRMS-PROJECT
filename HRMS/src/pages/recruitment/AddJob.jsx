import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { PageHeader, Card, Button, Input, Select, RichTextEditor } from '../../components/ui';
import { DEPARTMENTS } from '../../lib/constants';
import { useRecruitmentMutations } from '../../hooks/useModules';
import toast from 'react-hot-toast';

export default function AddJob() {
  const navigate = useNavigate();
  const { createJob } = useRecruitmentMutations();
  const [jd, setJd] = useState('');
  const [form, setForm] = useState({ title: '', department: '', location: '', type: 'full_time' });

  const publish = async () => {
    if (!form.title.trim()) return toast.error('Job title is required');
    try {
      await createJob.mutateAsync({
        title: form.title,
        department: form.department,
        location: form.location,
        employmentType: form.type,
        description: jd,
        status: 'open',
        openings: 1,
      });
      toast.success('Job posted successfully');
      navigate('/recruitment/jobs');
    } catch (err) {
      toast.error(err.message || 'Failed to post job');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <button type="button" onClick={() => navigate('/recruitment/jobs')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Job Openings
      </button>

      <PageHeader title="Post a New Job" subtitle="Create a new job opening" />

      <Card className="p-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Job title" required placeholder="e.g. Senior React Developer" containerClass="sm:col-span-2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Select label="Department" options={DEPARTMENTS} placeholder="Select department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            <Input label="Location" placeholder="e.g. Bangalore / Remote" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={[{ value: 'full_time', label: 'Full-time' }, { value: 'part_time', label: 'Part-time' }, { value: 'intern', label: 'Intern' }]} />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Job description</label>
            <RichTextEditor value={jd} onChange={setJd} placeholder="Describe the role, responsibilities and requirements..." />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-5 border-t border-border/60">
          <Button variant="outline" onClick={() => navigate('/recruitment/jobs')}>Cancel</Button>
          <Button icon={Send} onClick={publish} disabled={createJob.isPending}>Publish Job</Button>
        </div>
      </Card>
    </div>
  );
}
