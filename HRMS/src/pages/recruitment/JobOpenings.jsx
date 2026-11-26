import { Link, useNavigate } from 'react-router-dom';
import { Plus, MapPin, Briefcase, Globe, Users, Pencil, CalendarX } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, Button, StatusBadge, Badge, Skeleton, EmptyState } from '../../components/ui';
import { useJobs, useCandidates, useRecruitmentMutations } from '../../hooks/useModules';
import { useCan } from '../../hooks/useCan';
import { useAuthStore } from '../../store/authStore';
import { formatDate, humanize } from '../../lib/utils';

const WORK_MODE_LABEL = { on_site: 'On site', hybrid: 'Hybrid', remote: 'Remote' };

/** Past its closing date (India time): no longer shown on the website. */
const isPastClosing = (job) => Boolean(job.closesOn) && String(job.closesOn).slice(0, 10) < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function JobOpenings() {
  const navigate = useNavigate();
  const { data: jobs = [], isLoading } = useJobs();
  const { data: candidates = [] } = useCandidates();
  const { updateJob } = useRecruitmentMutations();
  // Editing and closing jobs: HR / Admin with Recruitment Create or Manage (as the server checks).
  const role = useAuthStore((s) => s.role);
  const canCreate = useCan('recruitment', 'create');
  const canManage = useCan('recruitment', 'manage');
  const canEdit = (role === 'hr' || role === 'admin') && (canCreate || canManage);

  const applicants = new Map();
  for (const c of candidates) if (c.jobId) applicants.set(c.jobId, (applicants.get(c.jobId) || 0) + 1);

  const setOpen = async (job, open) => {
    try {
      await updateJob.mutateAsync({ id: job.id, status: open ? 'open' : 'closed' });
      toast.success(open ? `${job.title} reopened` : `${job.title} closed${job.showOnWebsite ? ' — removed from your website' : ''}`);
    } catch (err) {
      toast.error(err.message || 'Could not update the job');
    }
  };

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
          {jobs.map((j) => {
            const open = j.status === 'active';
            const live = open && j.showOnWebsite && !isPastClosing(j);
            const count = applicants.get(j.id) || 0;
            return (
              <Card key={j.id} hover className="p-5 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-fg">{j.title}</p>
                    <p className="text-xs text-fg-subtle mt-0.5">{j.department}</p>
                  </div>
                  <StatusBadge status={j.status} dot={false} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {live && <Badge tone="success"><span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> On website</span></Badge>}
                  {open && j.showOnWebsite && isPastClosing(j) && <Badge tone="warning"><span className="inline-flex items-center gap-1"><CalendarX className="h-3 w-3" /> Past closing date</span></Badge>}
                  {j.workMode && <Badge tone="neutral">{WORK_MODE_LABEL[j.workMode] || humanize(j.workMode)}</Badge>}
                </div>
                <div className="mt-4 pt-4 border-t border-border/60 space-y-1.5 text-xs text-fg-muted">
                  {j.location && <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-fg-subtle" /> {j.location}</p>}
                  <p className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5 text-fg-subtle" /> {humanize(j.type)} · {j.openings} opening{j.openings === 1 ? '' : 's'}</p>
                  <p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-fg-subtle" /> {count} applicant{count === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center justify-between gap-2 mt-auto pt-4">
                  <span className="text-xs text-fg-subtle">{j.createdAt ? formatDate(j.createdAt, 'dd MMM yyyy') : '—'}</span>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setOpen(j, !open)} disabled={updateJob.isPending}>
                        {open ? 'Close' : 'Reopen'}
                      </Button>
                      <Button size="sm" icon={Pencil} onClick={() => navigate(`/recruitment/jobs/${j.id}/edit`)}>Edit</Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
