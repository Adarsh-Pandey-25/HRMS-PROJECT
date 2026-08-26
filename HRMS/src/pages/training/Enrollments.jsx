import { useMemo, useState } from 'react';
import { Plus, Users, CheckCircle2, Clock, CircleDot, Archive, ArchiveRestore } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, Select, Input, Modal,
  ProgressBar, DataTable, Skeleton, StatCard, Avatar, StatusBadge,
} from '../../components/ui';
import { useEnrollments, useArchivedEnrollmentCount, useManageCourses, useTrainingMutations } from '../../hooks/useTraining';
import { useEmployees } from '../../hooks/useEmployees';
import { DEPARTMENTS } from '../../lib/constants';
import { formatDate, humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

const FILTERS = {
  all: 'All enrollments',
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
};

function enrollmentStatusTone(status) {
  if (status === 'COMPLETED') return 'completed';
  if (status === 'IN_PROGRESS') return 'in-progress';
  if (status === 'NOT STARTED') return 'pending';
  return 'pending';
}

function classifyEnrollment(e) {
  const completedLessons = e.completedLessons ?? e.completed_lessons ?? 0;
  const totalLessons = e.totalLessons ?? e.total_lessons ?? 0;
  const progressPercent = e.progressPercent ?? e.progress_percent ?? (totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0);

  let bucket = 'not_started';
  if (e.status === 'COMPLETED') bucket = 'completed';
  else if (completedLessons > 0) bucket = 'in_progress';

  const displayStatus = bucket === 'completed'
    ? 'COMPLETED'
    : bucket === 'in_progress'
      ? 'IN PROGRESS'
      : 'NOT STARTED';

  return {
    id: e.id,
    employeeId: e.employeeId || e.userId,
    employeeName: e.employeeName || e.employee_name || 'Employee',
    department: e.department || '—',
    courseTitle: e.courseTitle || e.course_title || 'Course',
    enrolledOn: e.enrolledAt || e.enrolled_at,
    completedLessons,
    totalLessons,
    progressLabel: totalLessons ? `${completedLessons}/${totalLessons} lessons` : '—',
    progress: progressPercent,
    completedOn: e.completedAt || e.completed_at,
    deadline: e.deadline,
    status: displayStatus,
    statusTone: enrollmentStatusTone(displayStatus),
    bucket,
    isArchived: Boolean(e.isArchived ?? e.is_archived),
    canArchive: e.status === 'COMPLETED' && !Boolean(e.isArchived ?? e.is_archived),
  };
}

export default function Enrollments() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: enrollments = [], isLoading } = useEnrollments({ archivedOnly: showArchived });
  const { data: archivedCount = 0 } = useArchivedEnrollmentCount();
  const { data: courses = [] } = useManageCourses();
  const { employees } = useEmployees();
  const { createEnrollments, archiveEnrollment } = useTrainingMutations();
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [archivingId, setArchivingId] = useState(null);
  const [form, setForm] = useState({ courseId: '', target: 'all', department: '', employeeIds: [], deadline: '' });

  const rows = useMemo(() => enrollments.map(classifyEnrollment), [enrollments]);

  const stats = useMemo(() => {
    const uniqueEmployees = new Set(rows.map((r) => r.employeeId)).size;
    return {
      total: rows.length,
      uniqueEmployees,
      completed: rows.filter((r) => r.bucket === 'completed').length,
      inProgress: rows.filter((r) => r.bucket === 'in_progress').length,
      notStarted: rows.filter((r) => r.bucket === 'not_started').length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.bucket === filter);
  }, [rows, filter]);

  const assignCourse = async () => {
    if (!form.courseId) return toast.error('Select a course');
    let targets = employees;
    if (form.target === 'department') targets = employees.filter((e) => e.department === form.department);
    if (form.target === 'specific') targets = employees.filter((e) => form.employeeIds.includes(e.id));
    if (!targets.length) return toast.error('No employees match the selection');
    try {
      await createEnrollments.mutateAsync({
        courseId: form.courseId,
        employeeIds: targets.map((e) => e.id),
        deadline: form.deadline || null,
      });
      toast.success(`Assigned to ${targets.length} employee(s)`);
      setModal(false);
      setForm({ courseId: '', target: 'all', department: '', employeeIds: [], deadline: '' });
    } catch (err) {
      toast.error(err.message || 'Assignment failed');
    }
  };

  const handleArchive = async (row) => {
    if (!row.canArchive) return;
    try {
      setArchivingId(row.id);
      await archiveEnrollment.mutateAsync(row.id);
      toast.success(`Archived ${row.employeeName} — ${row.courseTitle}`);
    } catch (err) {
      toast.error(err.message || 'Archive failed');
    } finally {
      setArchivingId(null);
    }
  };

  const courseOptions = courses.map((c) => ({ value: c.id, label: c.title }));

  const columns = useMemo(() => [
    {
      accessorKey: 'employeeName',
      header: 'Employee',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.original.employeeName} size="sm" />
          <div>
            <p className="font-medium text-fg">{row.original.employeeName}</p>
            <p className="text-xs text-fg-subtle">{row.original.department}</p>
          </div>
        </div>
      ),
    },
    { accessorKey: 'courseTitle', header: 'Course' },
    {
      accessorKey: 'enrolledOn',
      header: 'Enrolled',
      cell: ({ getValue }) => formatDate(getValue()) || '—',
    },
    {
      accessorKey: 'progress',
      header: 'Progress',
      cell: ({ row }) => (
        <div className="min-w-[160px]">
          <div className="flex items-center justify-between text-xs text-fg-muted mb-1">
            <span>{row.original.progressLabel}</span>
            <span>{row.original.progress}%</span>
          </div>
          <ProgressBar value={row.original.progress} size="sm" />
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={row.original.statusTone} dot={false} label={humanize(row.original.status)} />
          {row.original.isArchived && (
            <StatusBadge status="archived" dot={false} label="Archived" />
          )}
        </div>
      ),
    },
    {
      accessorKey: 'completedOn',
      header: 'Completed',
      cell: ({ getValue }) => (getValue() ? formatDate(getValue()) : '—'),
    },
    {
      accessorKey: 'deadline',
      header: 'Deadline',
      cell: ({ getValue }) => (getValue() ? formatDate(getValue()) : '—'),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        !showArchived && row.original.canArchive ? (
          <Button
            size="sm"
            variant="outline"
            icon={Archive}
            loading={archivingId === row.original.id}
            disabled={archivingId === row.original.id}
            onClick={() => handleArchive(row.original)}
          >
            Archive
          </Button>
        ) : null
      ),
    },
  ], [showArchived, archivingId]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Enrollments"
        subtitle={showArchived ? 'Archived completed training records' : 'Track employee training progress and assign courses'}
        actions={(
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={showArchived ? 'default' : 'outline'}
              icon={showArchived ? ArchiveRestore : Archive}
              onClick={() => {
                setShowArchived((v) => !v);
                setFilter('all');
              }}
            >
              {showArchived ? 'Back to Active' : `View Archived${archivedCount ? ` (${archivedCount})` : ''}`}
            </Button>
            {!showArchived && (
              <Button icon={Plus} onClick={() => setModal(true)}>Assign Course</Button>
            )}
          </div>
        )}
      />

      {!showArchived && (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Enrolled"
          value={stats.total}
          icon={Users}
          tone="primary"
          footer={`${stats.uniqueEmployees} unique employees`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          tone="success"
          footer="Courses finished"
          active={filter === 'completed'}
          onClick={() => setFilter('completed')}
        />
        <StatCard
          label="In Progress"
          value={stats.inProgress}
          icon={Clock}
          tone="info"
          footer="Lessons started"
          active={filter === 'in_progress'}
          onClick={() => setFilter('in_progress')}
        />
        <StatCard
          label="Not Started"
          value={stats.notStarted}
          icon={CircleDot}
          tone="warning"
          footer="Enrolled, 0% progress"
          active={filter === 'not_started'}
          onClick={() => setFilter('not_started')}
        />
      </div>
      )}

      <Card>
        <CardHeader
          title={showArchived ? 'Archived Enrollments' : 'Employee Training Tracking'}
          subtitle={
            showArchived
              ? `${filteredRows.length} archived record${filteredRows.length !== 1 ? 's' : ''}`
              : `${filteredRows.length} ${FILTERS[filter].toLowerCase()}${filter !== 'all' ? '' : ` · ${rows.length} total`}`
          }
          action={!showArchived && filter !== 'all' ? (
            <Button size="sm" variant="ghost" onClick={() => setFilter('all')}>Clear filter</Button>
          ) : null}
        />
        {isLoading ? (
          <div className="p-5"><Skeleton className="h-48 rounded-xl" /></div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-fg-muted">
            {showArchived
              ? 'No archived enrollments yet. Completed records you archive will appear here.'
              : filter === 'all'
                ? 'No enrollments yet. Assign a course to start tracking employee training.'
                : `No ${FILTERS[filter].toLowerCase()} enrollments.`}
          </div>
        ) : (
          <DataTable columns={columns} data={filteredRows} pageSize={10} />
        )}
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Assign Course"
        footer={(
          <>
            <Button variant="outline" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={assignCourse} loading={createEnrollments.isPending}>Assign</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <Select label="Course" required placeholder="Select" options={courseOptions} value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} />
          <Select label="Assign to" options={[{ value: 'all', label: 'All employees' }, { value: 'department', label: 'Department' }, { value: 'specific', label: 'Specific employees' }]} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          {form.target === 'department' && <Select label="Department" options={DEPARTMENTS} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />}
          {form.target === 'specific' && (
            <div className="max-h-40 overflow-y-auto space-y-1.5 rounded-input border border-border p-3">
              {employees.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form.employeeIds.includes(e.id)}
                    onChange={() => setForm((f) => ({
                      ...f,
                      employeeIds: f.employeeIds.includes(e.id)
                        ? f.employeeIds.filter((x) => x !== e.id)
                        : [...f.employeeIds, e.id],
                    }))}
                  />
                  {e.name}
                </label>
              ))}
            </div>
          )}
          <Input label="Deadline (optional)" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
