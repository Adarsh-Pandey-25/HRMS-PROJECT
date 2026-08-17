import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, PlayCircle } from 'lucide-react';
import { PageHeader, Card, ProgressBar, EmptyState, Button, Skeleton, Badge } from '../../components/ui';
import { useCourseCatalog } from '../../hooks/useTraining';
import { humanize } from '../../lib/utils';

export default function MyTrainings() {
  const navigate = useNavigate();
  const { data: courses = [], isLoading } = useCourseCatalog();

  const enrolled = useMemo(
    () => (courses || []).filter((c) => c.enrollment || c.enrolled),
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
            return (
              <Card key={c.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-fg">{c.title}</p>
                      <Badge tone={pct >= 100 ? 'success' : 'info'}>{humanize(String(status).toLowerCase())}</Badge>
                    </div>
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
