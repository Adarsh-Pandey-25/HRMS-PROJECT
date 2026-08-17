import { Video } from 'lucide-react';
import { PageHeader, Card, CardHeader, Badge, EmptyState, Skeleton } from '../../components/ui';
import { useInterviews } from '../../hooks/useModules';
import { formatDate, humanize } from '../../lib/utils';

export default function Interviews() {
  const { data: interviews = [], isLoading } = useInterviews();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Interviews" subtitle="Scheduled interviews across all candidates" />

      <Card>
        <CardHeader title="Scheduled Interviews" subtitle="Upcoming" />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          ) : interviews.length === 0 ? (
            <EmptyState icon={Video} title="No interviews" message="Scheduled interviews will appear here." />
          ) : interviews.map((iv) => {
            const when = iv.scheduledAt || iv.scheduled_at;
            return (
              <div key={iv.id} className="flex items-center gap-4 rounded-xl border border-border/60 p-3">
                <div className="flex flex-col items-center justify-center h-12 w-12 rounded-lg bg-primary/10 text-primary shrink-0">
                  <span className="text-[10px] uppercase font-semibold">{when ? formatDate(when, 'MMM') : '—'}</span>
                  <span className="text-base font-semibold leading-none">{when ? formatDate(when, 'dd') : '—'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{iv.candidateName || iv.candidate_name || 'Candidate'}</p>
                  <p className="text-xs text-fg-subtle">
                    {iv.interviewer || 'Interviewer TBD'} · {humanize(iv.status || 'scheduled')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Badge tone="info">
                    <Video className="h-3 w-3" />
                    Interview
                  </Badge>
                  <p className="text-xs text-fg-subtle mt-1">{when ? formatDate(when, 'hh:mm a') : '—'}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
