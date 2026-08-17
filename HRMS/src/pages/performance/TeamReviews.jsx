import { useState } from 'react';
import { Award, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, CardHeader, Avatar, StatusBadge, Badge, Button, EmptyState, Skeleton, Modal, Input,
} from '../../components/ui';
import { useTeamReviews, useReviewCycles, usePerformanceMutations } from '../../hooks/useModules';
import { humanize } from '../../lib/utils';

export default function TeamReviews() {
  const { data: reviews = [], isLoading } = useTeamReviews();
  const { data: cycles = [] } = useReviewCycles();
  const { openTeamReviews, updateReview } = usePerformanceMutations();
  const cycleName = cycles.find((c) => c.status === 'active')?.name || cycles[0]?.name || 'Current cycle';
  const [reviewing, setReviewing] = useState(null);
  const [score, setScore] = useState('4');

  const openReviews = async () => {
    try {
      await openTeamReviews.mutateAsync(undefined);
      toast.success('Pending reviews opened for your team');
    } catch (err) {
      toast.error(err.message || 'Could not open reviews — create an active cycle first');
    }
  };

  const submitReview = async () => {
    if (!reviewing) return;
    const n = Number(score);
    if (Number.isNaN(n) || n < 1 || n > 5) return toast.error('Score must be 1–5');
    try {
      await updateReview.mutateAsync({ id: reviewing.id, score: n, status: 'completed', progress: 100 });
      toast.success('Review submitted');
      setReviewing(null);
    } catch (err) {
      toast.error(err.message || 'Failed to submit review');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Team Reviews"
        subtitle="Manager ratings for your direct reports"
        actions={<Button icon={Plus} variant="outline" onClick={openReviews} disabled={openTeamReviews.isPending}>Open team reviews</Button>}
      />

      <Card>
        <CardHeader title="Team Reviews" subtitle={cycleName} />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          ) : reviews.length === 0 ? (
            <EmptyState
              title="No reviews"
              message="Open team reviews for the active cycle, or create a cycle under Review Cycles first."
              action={<Button size="sm" onClick={openReviews}>Open team reviews</Button>}
            />
          ) : reviews.map((r) => {
            const emp = r.employee || {};
            const name = emp.firstName ? `${emp.firstName} ${emp.lastName}`.trim() : 'Employee';
            const val = r.score ?? r.managerRating;
            return (
              <div key={r.id || r.employeeId} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar name={name} size="md" />
                  <div>
                    <p className="text-sm font-medium text-fg">{name}</p>
                    <p className="text-xs text-fg-subtle">
                      Progress {r.progress ?? 0}% · {humanize(r.status || 'pending')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {val != null ? (
                    <Badge tone="success"><Award className="h-3 w-3" /> Rated {val}</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => { setReviewing(r); setScore('4'); }}>Review</Button>
                  )}
                  <StatusBadge
                    status={r.status === 'completed' ? 'approved' : r.status === 'pending' ? 'pending' : 'processing'}
                    label={humanize(r.status || 'pending')}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title="Submit review"
        subtitle={reviewing?.employee ? `${reviewing.employee.firstName || ''} ${reviewing.employee.lastName || ''}`.trim() : undefined}
        footer={(
          <>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
            <Button onClick={submitReview} disabled={updateReview.isPending}>Submit</Button>
          </>
        )}
      >
        <Input
          label="Rating (1–5)"
          type="number"
          min={1}
          max={5}
          step={0.5}
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
      </Modal>
    </div>
  );
}
