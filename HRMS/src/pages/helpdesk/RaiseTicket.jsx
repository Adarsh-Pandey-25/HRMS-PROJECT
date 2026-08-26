import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { PageHeader, Card, Button, Input, Select, RichTextEditor } from '../../components/ui';
import { useHelpdeskMutations } from '../../hooks/useModules';
import { useSettingsStore } from '../../store/settingsStore';
import { stripHtml, humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

const FALLBACK_CATEGORIES = ['it', 'hr', 'admin', 'finance', 'payroll', 'other'];

const toCategoryValue = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '_');

export default function RaiseTicket() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { createTicket } = useHelpdeskMutations();
  const configured = useSettingsStore((s) => s.helpdeskConfig?.categories) || [];
  const categoryOptions = (configured.length ? configured : FALLBACK_CATEGORIES).map((c) => ({
    value: toCategoryValue(c),
    label: c,
  }));
  const allowed = categoryOptions.map((o) => o.value);
  const initialCategory = toCategoryValue(searchParams.get('category') || 'it');
  const category = allowed.includes(initialCategory)
    ? initialCategory
    : (initialCategory === 'assets' && allowed.includes('admin') ? 'admin' : (allowed[0] || 'it'));
  const [form, setForm] = useState({
    subject: searchParams.get('subject') || '',
    category,
    priority: 'medium',
    description: '',
  });

  const submit = async () => {
    const description = stripHtml(form.description);
    if (!form.subject.trim() || !description) return toast.error('Please fill subject and description');
    try {
      await createTicket.mutateAsync({ ...form, subject: form.subject.trim(), description });
      toast.success('Ticket raised');
      navigate('/helpdesk/me');
    } catch (err) {
      toast.error(err.message || 'Failed to raise ticket');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button type="button" onClick={() => navigate('/helpdesk/me')} className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to My Tickets
      </button>

      <PageHeader title="Raise a Ticket" subtitle="Get help from IT, HR, Admin, Finance or Payroll" />

      <Card className="p-6">
        <div className="space-y-4">
          <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief summary of your issue" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={categoryOptions} />
            <Select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={['low', 'medium', 'high', 'critical'].map((c) => ({ value: c, label: humanize(c) }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Description</label>
            <RichTextEditor value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Describe your issue in detail…" />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-5 border-t border-border/60">
          <Button variant="outline" onClick={() => navigate('/helpdesk/me')}>Cancel</Button>
          <Button icon={Send} onClick={submit} disabled={createTicket.isPending}>Submit Ticket</Button>
        </div>
      </Card>
    </div>
  );
}
