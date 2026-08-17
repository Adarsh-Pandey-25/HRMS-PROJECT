import { useState } from 'react';
import { Target, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, StatusBadge, EmptyState, Skeleton, ProgressBar,
  Button, Modal, Input, Select,
} from '../../components/ui';
import { useMyGoals, usePerformanceMutations } from '../../hooks/useModules';
import { formatDate } from '../../lib/utils';

const STATUS_OPTIONS = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'completed', label: 'Completed' },
];

export default function MyGoals() {
  const { data: goals = [], isLoading } = useMyGoals();
  const { createGoal, updateGoal } = usePerformanceMutations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', dueDate: '', cycle: '' });

  const save = async () => {
    if (!form.title.trim()) return toast.error('Title is required');
    try {
      await createGoal.mutateAsync({
        title: form.title.trim(),
        dueDate: form.dueDate || undefined,
        cycle: form.cycle || undefined,
      });
      toast.success('Goal created');
      setOpen(false);
      setForm({ title: '', dueDate: '', cycle: '' });
    } catch (err) {
      toast.error(err.message || 'Failed to create goal');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Goals"
        subtitle="OKR tracking and progress from the performance module"
        actions={<Button icon={Plus} onClick={() => setOpen(true)}>Add Goal</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <Skeleton className="h-32 md:col-span-2 rounded-card" />
        ) : goals.length === 0 ? (
          <Card className="py-6 md:col-span-2">
            <EmptyState
              icon={Target}
              title="No goals yet"
              message="Add a personal goal or wait for HR/manager to assign one."
              action={<Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Add Goal</Button>}
            />
          </Card>
        ) : goals.map((g) => (
          <Card key={g.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-fg">{g.title}</p>
              <StatusBadge status={g.status?.replace(/_/g, '-')} dot={false} />
            </div>
            <p className="text-xs text-fg-subtle mt-1">Cycle: {g.cycle || '—'} · Due {g.dueDate ? formatDate(g.dueDate) : '—'}</p>
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex justify-between text-xs text-fg-subtle mb-1">
                  <span>Progress</span>
                  <span>{g.progress}%</span>
                </div>
                <ProgressBar value={g.progress} size="sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  label="Update %"
                  value={g.progress}
                  onChange={async (e) => {
                    const progress = Number(e.target.value);
                    try {
                      await updateGoal.mutateAsync({ id: g.id, progress });
                    } catch (err) {
                      toast.error(err.message || 'Update failed');
                    }
                  }}
                />
                <Select
                  label="Status"
                  value={g.status || 'on_track'}
                  options={STATUS_OPTIONS}
                  onChange={async (e) => {
                    try {
                      await updateGoal.mutateAsync({ id: g.id, status: e.target.value });
                      toast.success('Status updated');
                    } catch (err) {
                      toast.error(err.message || 'Update failed');
                    }
                  }}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add goal"
        footer={(
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={createGoal.isPending}>{createGoal.isPending ? 'Saving…' : 'Create'}</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Input label="Title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Improve customer NPS" />
          <Input label="Cycle (optional)" value={form.cycle} onChange={(e) => setForm((f) => ({ ...f, cycle: e.target.value }))} placeholder="Q3 2026" />
          <Input label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}
