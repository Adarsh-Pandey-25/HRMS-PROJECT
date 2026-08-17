import { useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, StatusBadge, ProgressBar, EmptyState, Skeleton, Button, Modal, Input, Select,
} from '../../components/ui';
import { useReviewCycles, usePerformanceMutations } from '../../hooks/useModules';
import { useAuthStore } from '../../store/authStore';
import { formatDate, humanize } from '../../lib/utils';

export default function ReviewCycles() {
  const role = useAuthStore((s) => s.role);
  const canCreate = role === 'admin' || role === 'hr';
  const { data: cycles = [], isLoading } = useReviewCycles();
  const { createCycle } = usePerformanceMutations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', status: 'active' });

  const save = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    try {
      await createCycle.mutateAsync(form);
      toast.success('Review cycle created');
      setOpen(false);
      setForm({ name: '', startDate: '', endDate: '', status: 'active' });
    } catch (err) {
      toast.error(err.message || 'Failed to create cycle');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Review Cycles"
        subtitle="Manage performance review periods"
        actions={canCreate ? <Button icon={Plus} onClick={() => setOpen(true)}>Create cycle</Button> : null}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-card" />)}
        </div>
      ) : cycles.length === 0 ? (
        <Card className="py-10">
          <EmptyState
            title="No review cycles"
            message="Create a review cycle to start collecting feedback."
            action={canCreate ? <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Create cycle</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cycles.map((c) => {
            const participants = Number(c.participants || 0);
            const submitted = Number(c.submitted || c.progress || 0);
            const pct = participants > 0 ? Math.round((submitted / participants) * 100) : 0;
            const period = c.startDate && c.endDate
              ? `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`
              : c.period || '—';
            return (
              <Card key={c.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-fg">{c.name}</p>
                    <p className="text-xs text-fg-subtle mt-0.5">{period}</p>
                  </div>
                  <StatusBadge status={c.status === 'active' ? 'processing' : 'approved'} label={humanize(c.status || 'draft')} />
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-fg-subtle mb-1">
                    <span>Participants</span>
                    <span>{participants || '—'}</span>
                  </div>
                  <ProgressBar value={pct} tone={c.status === 'active' ? 'primary' : 'success'} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create review cycle"
        footer={(
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={createCycle.isPending}>Create</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Input label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="H2 2026 Review" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            <Input label="End" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          <Select
            label="Status"
            value={form.status}
            options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }, { value: 'closed', label: 'Closed' }]}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          />
        </div>
      </Modal>
    </div>
  );
}
