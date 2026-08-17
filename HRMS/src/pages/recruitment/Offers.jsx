import { PageHeader, Card, CardHeader, Avatar, StatusBadge, EmptyState, Skeleton } from '../../components/ui';
import { useOffers, useJobs } from '../../hooks/useModules';
import { formatCurrency } from '../../lib/utils';

export default function Offers() {
  const { data: offers = [], isLoading: offersLoading } = useOffers();
  const { data: jobs = [] } = useJobs();
  const jobTitle = (jobId) => jobs.find((j) => j.id === jobId)?.title || 'Role';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Offers" subtitle="Offer letters and onboarding checklist" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Offer Letters" subtitle="Sent & pending acceptance" />
          <div className="p-5 pt-3 space-y-2">
            {offersLoading ? (
              [1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)
            ) : offers.length === 0 ? (
              <EmptyState title="No offers" message="No offers extended yet." />
            ) : offers.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border/60 p-3">
                <Avatar name={o.candidateName || o.candidate_name || 'Candidate'} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg">{o.candidateName || o.candidate_name || 'Candidate'}</p>
                  <p className="text-xs text-fg-subtle">
                    {jobTitle(o.jobId || o.job_id)}
                    {o.amount != null && ` · ${formatCurrency(o.amount)}`}
                  </p>
                </div>
                <StatusBadge
                  status={o.status === 'accepted' ? 'approved' : 'pending'}
                  label={o.status === 'accepted' ? 'Accepted' : humanizeStatus(o.status)}
                />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Onboarding Checklist" subtitle="For accepted candidates" />
          <div className="p-5 pt-3 space-y-2">
            {['Create employee record', 'Assign work email & laptop', 'Send welcome kit', 'Schedule orientation', 'Add to payroll'].map((task, i) => (
              <label key={task} className="flex items-center gap-3 rounded-xl border border-border/60 p-3 cursor-pointer hover:bg-muted/40">
                <input type="checkbox" defaultChecked={i < 2} className="h-4 w-4 accent-[#6C63FF]" />
                <span className="text-sm text-fg">{task}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function humanizeStatus(s) {
  if (!s) return 'Pending';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
