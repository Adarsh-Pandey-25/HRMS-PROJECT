import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, AlertTriangle, CheckCircle2, Lock, PlayCircle, Bell } from 'lucide-react';
import { PageHeader, Card, CardHeader, Button, Badge, Select, ProgressBar, DataTable, Skeleton } from '../../components/ui';
import { useCourseCatalog, useTrainingProgressReport } from '../../hooks/useTraining';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore, useCurrentUser } from '../../store/authStore';
import { isNewJoiner, newJoinerDeadline, daysUntil } from '../../lib/training';
import { formatDate, cn } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function NewJoinerTraining() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);
  const user = useCurrentUser();
  const trainingConfig = useSettingsStore((s) => s.trainingConfig) || {
    newJoinerWindowDays: 90,
    newJoinerDeadlineDays: 30,
    enforceWatchOrder: true,
  };
  const [filter, setFilter] = useState('');
  const isAdmin = ['admin', 'hr'].includes(role);

  const { data: report, isLoading: reportLoading } = useTrainingProgressReport();
  const { data: catalog = [], isLoading: catalogLoading } = useCourseCatalog();

  const joinUser = useMemo(() => ({
    ...user,
    joinDate: user?.joinDate || user?.dateOfJoining || user?.date_of_joining,
  }), [user]);

  if (isAdmin) {
    const windowDays = trainingConfig.newJoinerWindowDays ?? 90;
    const deadlineDays = trainingConfig.newJoinerDeadlineDays ?? 30;
    const employees = report?.employees || [];

    const rows = employees
      .map((e) => {
        const emp = {
          id: e.employeeId,
          name: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          department: e.department,
          joinDate: e.dateOfJoining,
        };
        if (!isNewJoiner(emp, windowDays)) return null;
        const completedCount = e.completedCount || 0;
        const total = e.assignedCount || 0;
        const deadline = newJoinerDeadline(emp, deadlineDays);
        const remaining = daysUntil(deadline);
        const overdue = remaining != null && remaining < 0 && completedCount < total;
        return { emp, completedCount, pending: Math.max(0, total - completedCount), deadline, overdue, total };
      })
      .filter(Boolean);

    const filtered = filter === 'overdue' ? rows.filter((r) => r.overdue) : rows;

    const columns = [
      {
        id: 'name',
        header: 'Employee',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-fg">{row.original.emp.name}</p>
            <p className="text-xs text-fg-subtle">{row.original.emp.department}</p>
          </div>
        ),
      },
      { id: 'joinDate', header: 'Join Date', cell: ({ row }) => formatDate(row.original.emp.joinDate) },
      { id: 'completed', header: 'Completed', cell: ({ row }) => `${row.original.completedCount}/${row.original.total}` },
      { id: 'pending', header: 'Pending', cell: ({ row }) => row.original.pending },
      { id: 'deadline', header: 'Deadline', cell: ({ row }) => formatDate(row.original.deadline) },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (row.original.overdue
          ? <Badge tone="danger">Overdue</Badge>
          : row.original.pending === 0
            ? <Badge tone="success">Complete</Badge>
            : <Badge tone="info">On track</Badge>),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => row.original.pending > 0 && (
          <Button size="sm" variant="outline" icon={Bell} onClick={() => toast.success(`Reminder queued for ${row.original.emp.name}`)}>
            Remind
          </Button>
        ),
      },
    ];

    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="New Joiner Training" subtitle="Completion tracking for employees in their onboarding window" />
        <Card>
          <CardHeader
            title="Completion Tracking"
            subtitle={`${rows.length} employees within the new joiner window`}
            action={(
              <Select
                placeholder="All new joiners"
                options={[{ value: 'overdue', label: 'Overdue only' }]}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
          />
          {reportLoading
            ? <div className="p-5"><Skeleton className="h-40 rounded-xl" /></div>
            : <DataTable columns={columns} data={filtered} emptyTitle="No new joiners" emptyMessage="No employees currently fall within the new joiner window." />}
        </Card>
      </div>
    );
  }

  const isNJ = isNewJoiner(joinUser, trainingConfig.newJoinerWindowDays ?? 90);
  const deadline = newJoinerDeadline(joinUser, trainingConfig.newJoinerDeadlineDays ?? 30);
  const remaining = daysUntil(deadline);
  const courses = catalog;
  const completedCount = courses.filter((c) => c.enrollment?.status === 'COMPLETED' || c.progressPercent === 100).length;
  const pct = courses.length ? Math.round((completedCount / courses.length) * 100) : 0;
  const allDone = courses.length > 0 && completedCount === courses.length;

  const statusFor = (course) => {
    if (course.enrollment?.status === 'COMPLETED' || course.progressPercent === 100) return 'completed';
    if (course.enrollment) return 'in-progress';
    return 'not-started';
  };

  const isLocked = (course, index) => {
    if (!isNJ || !trainingConfig.enforceWatchOrder) return false;
    if (index === 0) return false;
    const prev = courses[index - 1];
    return statusFor(prev) !== 'completed';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="New Joiner Training" subtitle={isNJ ? 'Your onboarding checklist' : 'Your assigned training courses'} />

      {catalogLoading ? (
        <Skeleton className="h-32 rounded-card" />
      ) : isNJ ? (
        <Card className={cn('p-5', allDone ? 'bg-success/5 border-success/30' : remaining < 0 ? 'bg-danger/5 border-danger/30' : '')}>
          {allDone ? (
            <div className="flex items-center gap-3">
              <PartyPopper className="h-8 w-8 text-success shrink-0" />
              <div>
                <p className="font-semibold text-fg">Congratulations — onboarding training complete!</p>
                <p className="text-sm text-fg-muted mt-0.5">HR has been notified. Welcome aboard!</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <PlayCircle className="h-6 w-6 text-primary shrink-0" />
                <div>
                  <p className="font-semibold text-fg">Welcome to the team!</p>
                  <p className="text-sm text-fg-muted mt-0.5">
                    Complete the courses below within {trainingConfig.newJoinerDeadlineDays ?? 30} days of joining.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar value={pct} className="flex-1" />
                <span className="text-xs font-medium text-fg-subtle whitespace-nowrap">
                  {completedCount} of {courses.length} completed
                </span>
              </div>
              <p className={cn('mt-2 text-xs font-medium', remaining < 0 ? 'text-danger' : 'text-fg-subtle')}>
                {remaining < 0 ? (
                  <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Overdue — finish remaining courses</span>
                ) : `${remaining} day${remaining === 1 ? '' : 's'} remaining`}
              </p>
            </>
          )}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {courses.map((c, index) => {
          const st = statusFor(c);
          const locked = isLocked(c, index);
          return (
            <Card key={c.id} className="p-4">
              <div className="flex items-center justify-between">
                <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{index + 1}</span>
                {isNJ && <Badge tone="danger">Mandatory</Badge>}
              </div>
              <p className="mt-2.5 font-medium text-fg">{c.title}</p>
              <p className="text-xs text-fg-subtle mt-0.5">{c.totalLessons || c.total_lessons || 0} lessons</p>
              <p className="mt-2 text-xs">
                {st === 'completed' ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Completed</span>
                  : st === 'in-progress' ? <span className="text-info">In Progress</span>
                  : <span className="text-fg-subtle">Not Started</span>}
              </p>
              <Button
                className="mt-3 w-full"
                size="sm"
                variant={st === 'completed' ? 'outline' : 'primary'}
                disabled={locked}
                icon={locked ? Lock : undefined}
                onClick={() => navigate(`/training/courses/${c.id}/play`)}
              >
                {locked ? 'Locked' : st === 'completed' ? 'Rewatch' : 'Watch'}
              </Button>
            </Card>
          );
        })}
      </div>

      {!catalogLoading && courses.length === 0 && (
        <Card className="p-8 text-center text-sm text-fg-subtle">No courses assigned for your department yet.</Card>
      )}
    </div>
  );
}
