import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, PlayCircle, ShieldAlert, CalendarClock } from 'lucide-react';
import { PageHeader, Card, ProgressBar, EmptyState, Button, Skeleton, Badge } from '../../components/ui';
import { useCourseCatalog } from '../../hooks/useTraining';
import { humanize, formatDate, cn } from '../../lib/utils';

export default function MyTrainings() {
  const navigate = useNavigate();
  const { data: courses = [], isLoading } = useCourseCatalog();

  // Item 1: mandatory (HR/Admin-assigned) courses surface first, not buried
  // among self-enrolled ones — the employee can't decline, hide, or ignore
  // them, so they stay visibly prominent until completed. Now split into
  // their own headed group rather than merely sorted to the top, so "what am
  // I obliged to finish" is answerable without reading every card, and
  // overdue ones lead within it.
  const { required, optional } = useMemo(() => {
    const enrolled = (courses || []).filter((c) => c.enrollment || c.enrolled);
    const rank = (c) => {
      const pct = c.progressPercent ?? 0;
      if (c.enrollment?.isOverdue) return 0;
      if (pct < 100) return 1;
      return 2;
    };
    const byUrgency = (a, b) => rank(a) - rank(b);
    return {
      required: enrolled.filter((c) => c.enrollment?.isMandatory).sort(byUrgency),
      optional: enrolled.filter((c) => !c.enrollment?.isMandatory).sort(byUrgency),
    };
  }, [courses]);
  const enrolled = [...required, ...optional];

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
        <div className="space-y-6">
          {[
            { key: 'required', title: 'Required', items: required, note: 'Assigned to you — these have to be completed.' },
            { key: 'optional', title: 'Optional', items: optional, note: 'Courses you enrolled in yourself.' },
          ].filter((group) => group.items.length > 0).map((group) => (
            <section key={group.key} className="space-y-3">
              {/* Only head the groups when both exist — a single heading over
                  the whole list is noise, not structure. */}
              {required.length > 0 && optional.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-fg">
                    {group.title}
                    <span className="ml-2 text-xs font-normal text-fg-subtle">{group.items.length}</span>
                  </h2>
                  <p className="text-xs text-fg-subtle">{group.note}</p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.items.map((c) => {
                  const completed = c.completedLessons ?? c.completed_lessons ?? 0;
                  const total = c.totalLessons ?? c.total_lessons ?? 0;
                  const pct = c.progressPercent ?? (total ? Math.round((completed / total) * 100) : 0);
                  const status = c.enrollment?.status || c.status || 'in_progress';
                  const isMandatory = Boolean(c.enrollment?.isMandatory);
                  const deadline = c.enrollment?.deadline || c.deadline || null;
                  const isOverdue = Boolean(c.enrollment?.isOverdue ?? c.isOverdue);
                  return (
                    <Card
                      key={c.id}
                      className={cn(
                        'p-5',
                        isOverdue && pct < 100 && 'ring-1 ring-danger/60',
                        !isOverdue && isMandatory && pct < 100 && 'ring-1 ring-warning/50',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <BookOpen className="h-6 w-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-fg">{c.title}</p>
                            <Badge tone={pct >= 100 ? 'success' : isOverdue ? 'danger' : 'info'}>
                              {isOverdue && pct < 100 ? 'Overdue' : humanize(String(status).toLowerCase())}
                            </Badge>
                          </div>
                          {isMandatory && pct < 100 && (
                            <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning">
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Assigned by {c.enrollment.assignedByName} — Required
                            </p>
                          )}
                          {deadline && pct < 100 && (
                            <p className={cn(
                              'mt-1 flex items-center gap-1 text-xs',
                              isOverdue ? 'font-medium text-danger' : 'text-fg-subtle',
                            )}>
                              <CalendarClock className="h-3.5 w-3.5" />
                              {isOverdue ? `Was due ${formatDate(deadline)}` : `Due ${formatDate(deadline)}`}
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
