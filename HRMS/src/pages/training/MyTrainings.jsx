import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, PlayCircle, ShieldAlert } from 'lucide-react';
import { PageHeader, Card, ProgressBar, EmptyState, Button, Skeleton, Badge } from '../../components/ui';
import { useCourseCatalog } from '../../hooks/useTraining';
import { humanize } from '../../lib/utils';

export default function MyTrainings() {
  const navigate = useNavigate();
  const { data: courses = [], isLoading } = useCourseCatalog();

  // Item 1: mandatory (HR/Admin-assigned) courses surface first, not buried
  // among self-enrolled ones — the employee can't decline, hide, or ignore
  // them, so they stay visibly prominent until completed.
  const enrolled = useMemo(
    () => (courses || [])
      .filter((c) => c.enrollment || c.enrolled)
      .sort((a, b) => (b.enrollment?.isMandatory ? 1 : 0) - (a.enrollment?.isMandatory ? 1 : 0)),
    [courses]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Trainings"
        subtitle="Courses you are enrolled in"
        actions={<Button variant="outline" onClick={() => navigate('/training/catalog')}>Browse catalog</Button>}
      />

      {isLoading ? (
        <Skeleton className="h-32 rounded-card" />
      ) : enrolled.length === 0 ? (
        <Card className="py-8">
          <EmptyState
            icon={GraduationCap}
            title="No trainings yet"
            message="Browse the course catalog to enroll in courses."
            action={<Button onClick={() => navigate('/training/catalog')}>Browse catalog</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {enrolled.map((c) => {
            const completed = c.completedLessons ?? c.completed_lessons ?? 0;
            const total = c.totalLessons ?? c.total_lessons ?? 0;
            const pct = c.progressPercent ?? (total ? Math.round((completed / total) * 100) : 0);
            const status = c.enrollment?.status || c.status || 'in_progress';
            const isMandatory = Boolean(c.enrollment?.isMandatory);
            return (
              <Card key={c.id} className={isMandatory && pct < 100 ? 'p-5 ring-1 ring-warning/50' : 'p-5'}>
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-fg">{c.title}</p>
                      <Badge tone={pct >= 100 ? 'success' : 'info'}>{humanize(String(status).toLowerCase())}</Badge>
                    </div>
                    {isMandatory && pct < 100 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Assigned by {c.enrollment.assignedByName} — Required
                      </p>
                    )}
                    <p className="text-xs text-fg-subtle mt-0.5">{completed}/{total} lessons</p>
                    <div className="mt-3">
                      <ProgressBar value={pct} size="sm" />
                      <p className="text-xs text-fg-subtle mt-1">{pct}% complete</p>
                    </div>
                    <Button
                      size="sm"
                      className="mt-3"
                      icon={PlayCircle}
                      onClick={() => navigate(`/training/courses/${c.id}/play`)}
                    >
                      {pct > 0 ? 'Continue' : 'Start'}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
