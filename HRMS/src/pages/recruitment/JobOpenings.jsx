import { Link } from 'react-router-dom';
import { Plus, MapPin, Briefcase } from 'lucide-react';
import { PageHeader, Card, Button, StatusBadge, Skeleton, EmptyState } from '../../components/ui';
import { useJobs } from '../../hooks/useModules';
import { formatDate, humanize } from '../../lib/utils';

export default function JobOpenings() {
  const { data: jobs = [], isLoading } = useJobs();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Job Openings"
        subtitle="Active and past postings"
        actions={<Link to="/recruitment/jobs/add"><Button icon={Plus}>Post a Job</Button></Link>}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-card" />)}
        </div>
      ) : jobs.length === 0 ? (
        <Card className="py-8"><EmptyState title="No job openings" message="Post your first job to start recruiting." /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {jobs.map((j) => (
            <Card key={j.id} hover className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{j.title}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">{j.department}</p>
                </div>
                <StatusBadge status={j.status} dot={false} />
              </div>
              <div className="mt-4 pt-4 border-t border-border/60 space-y-1.5 text-xs text-fg-muted">
                {j.location && <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-fg-subtle" /> {j.location}</p>}
                <p className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5 text-fg-subtle" /> {humanize(j.type)} · {j.openings} opening{j.openings === 1 ? '' : 's'}</p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-fg-subtle">{j.createdAt ? formatDate(j.createdAt, 'dd MMM yyyy') : '—'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
