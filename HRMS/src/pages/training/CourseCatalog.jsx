import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, PlayCircle, Plus, Pencil, Archive, Trash2, ListVideo, Settings2 } from 'lucide-react';
import {
  PageHeader, Card, Badge, EmptyState, Button, Skeleton, ProgressBar,
  Modal, Input, RichTextEditor, StatusBadge,
} from '../../components/ui';
import {
  useCourseCatalog, useManageCourses, useManageCourse, useTrainingMutations,
} from '../../hooks/useTraining';
import { useCan } from '../../hooks/useCan';
import { DEPARTMENTS } from '../../lib/constants';
import { stripHtml, humanize } from '../../lib/utils';
import toast from 'react-hot-toast';

const ALL_DEPT_OPTIONS = ['all', ...DEPARTMENTS];

function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const d = video.duration;
      URL.revokeObjectURL(url);
      if (!d || Number.isNaN(d)) reject(new Error('Could not read video duration'));
      else resolve(d);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid video file'));
    };
    video.src = url;
  });
}

function CourseFormModal({ open, onClose, editing, form, setForm, onSave, saving }) {
  const toggleDept = (d) =>
    setForm((f) => {
      if (d === 'all') return { ...f, departmentAccess: ['all'] };
      const withoutAll = f.departmentAccess.filter((x) => x !== 'all');
      return { ...f, departmentAccess: withoutAll.includes(d) ? withoutAll.filter((x) => x !== d) : [...withoutAll, d] };
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Course' : 'Add New Course'}
      size="lg"
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={saving}>{editing ? 'Save Changes' : 'Create Course'}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <RichTextEditor value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} minHeight={100} />
        <div>
          <p className="text-xs font-medium text-fg-muted mb-2">Department access</p>
          <div className="flex flex-wrap gap-3">
            {ALL_DEPT_OPTIONS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.departmentAccess.includes(d)} onChange={() => toggleDept(d)} />
                {d === 'all' ? 'All Departments' : d}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LessonsModal({ course, onClose, lessonForm, setLessonForm, onVideoFile, onSaveLesson, saving, lessons }) {
  return (
    <Modal
      open={Boolean(course)}
      onClose={onClose}
      title={`Lessons — ${course?.title || ''}`}
      size="lg"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          {(lessons || []).length === 0 ? (
            <p className="text-sm text-fg-subtle">No lessons yet. Add the first lesson below.</p>
          ) : (
            <ul className="space-y-2">
              {lessons.map((l, i) => (
                <li key={l.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="text-fg">
                    <span className="text-fg-subtle mr-2">{i + 1}.</span>
                    {l.title}
                    <span className="ml-2 text-xs text-fg-subtle">
                      {l.type === 'EXTERNAL_LINK' ? 'Link' : `Video · ${Math.round(l.videoDuration || 0)}s`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-semibold text-fg">Add lesson</p>
          <Input label="Lesson title" required value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="lessonType" checked={lessonForm.type === 'VIDEO_UPLOAD'} onChange={() => setLessonForm({ ...lessonForm, type: 'VIDEO_UPLOAD' })} />
              Upload file
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="lessonType" checked={lessonForm.type === 'EXTERNAL_LINK'} onChange={() => setLessonForm({ ...lessonForm, type: 'EXTERNAL_LINK' })} />
              Paste link
            </label>
          </div>
          {lessonForm.type === 'VIDEO_UPLOAD' ? (
            <div>
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                onChange={(e) => onVideoFile(e.target.files?.[0])}
                className="block w-full text-sm text-fg-muted"
              />
              {lessonForm.videoDuration > 0 && (
                <p className="text-xs text-fg-subtle mt-1">Duration: {Math.round(lessonForm.videoDuration)}s</p>
              )}
            </div>
          ) : (
            <Input
              label="External URL"
              placeholder="https://..."
              value={lessonForm.externalLink}
              onChange={(e) => setLessonForm({ ...lessonForm, externalLink: e.target.value })}
            />
          )}
          {lessonForm.type === 'EXTERNAL_LINK' && (
            <Input
              label="Video length (seconds)"
              type="number"
              min={1}
              required
              placeholder="e.g. 600"
              value={lessonForm.videoDuration || ''}
              onChange={(e) => setLessonForm({ ...lessonForm, videoDuration: Number(e.target.value) || 0 })}
            />
          )}
          <Button size="sm" icon={Plus} onClick={onSaveLesson} loading={saving}>Add Lesson</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function CourseCatalog() {
  const navigate = useNavigate();
  const canManage = useCan('training', 'manage');
  const { data: catalogCourses = [], isLoading: catalogLoading } = useCourseCatalog();
  const { data: manageCourses = [], isLoading: manageLoading } = useManageCourses(canManage);
  const { enroll, createCourse, updateCourse, deleteCourse, archiveCourse, addLesson } = useTrainingMutations();

  const courses = canManage ? manageCourses : catalogCourses;
  const isLoading = canManage ? manageLoading : catalogLoading;

  const blankForm = { title: '', description: '', departmentAccess: ['all'] };
  const [modal, setModal] = useState(false);
  const [lessonsModal, setLessonsModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [lessonForm, setLessonForm] = useState({
    title: '', type: 'VIDEO_UPLOAD', externalLink: '', videoFile: null, videoDuration: 0,
  });

  const { data: courseDetail } = useManageCourse(lessonsModal?.id);

  useEffect(() => {
    if (!lessonsModal) {
      setLessonForm({ title: '', type: 'VIDEO_UPLOAD', externalLink: '', videoFile: null, videoDuration: 0 });
    }
  }, [lessonsModal]);

  const handleEnroll = async (course) => {
    try {
      if (!course.enrollment) {
        await enroll.mutateAsync(course.id);
        toast.success(`Enrolled in ${course.title}`);
      }
      navigate(`/training/courses/${course.id}/play`);
    } catch (err) {
      toast.error(err.message || 'Enrollment failed');
    }
  };

  const openAdd = () => { setEditing(null); setForm(blankForm); setModal(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      title: c.title || '',
      description: c.description || '',
      departmentAccess: c.targetDepartments || c.departmentAccess || ['all'],
    });
    setModal(true);
  };

  const saveCourse = async () => {
    if (!form.title.trim()) return toast.error('Title is required');
    try {
      const payload = { ...form, targetDepartments: form.departmentAccess, status: 'ACTIVE' };
      if (editing) {
        await updateCourse.mutateAsync({ id: editing.id, payload });
        toast.success('Course updated');
        setModal(false);
      } else {
        const created = await createCourse.mutateAsync(payload);
        toast.success('Course created — add lessons next');
        setModal(false);
        setLessonsModal(created);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to save course');
    }
  };

  const archiveCourseHandler = async (id) => {
    if (!window.confirm('Archive this course? Employees will no longer see it in the catalog.')) return;
    try {
      await archiveCourse.mutateAsync(id);
      toast.success('Course archived');
    } catch (err) {
      toast.error(err.message || 'Failed to archive');
    }
  };

  const deleteCourseHandler = async (id, title) => {
    if (!window.confirm(`Permanently delete "${title || 'this course'}"? This cannot be undone.`)) return;
    try {
      await deleteCourse.mutateAsync(id);
      toast.success('Course deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const onVideoFile = async (file) => {
    if (!file) return;
    try {
      const duration = await readVideoDuration(file);
      setLessonForm((f) => ({ ...f, videoFile: file, videoDuration: duration }));
    } catch (err) {
      toast.error(err.message || 'Could not read video');
      setLessonForm((f) => ({ ...f, videoFile: null, videoDuration: 0 }));
    }
  };

  const saveLesson = async () => {
    if (!lessonsModal?.id) return;
    if (!lessonForm.title.trim()) return toast.error('Lesson title is required');
    if (lessonForm.type === 'VIDEO_UPLOAD' && !lessonForm.videoFile) {
      return toast.error('Upload a video file');
    }
    if (lessonForm.type === 'EXTERNAL_LINK' && !lessonForm.externalLink.trim()) {
      return toast.error('Paste an external link');
    }
    if (lessonForm.type === 'EXTERNAL_LINK' && !(Number(lessonForm.videoDuration) > 0)) {
      return toast.error('Enter the video length in seconds');
    }
    try {
      await addLesson.mutateAsync({
        courseId: lessonsModal.id,
        title: lessonForm.title,
        type: lessonForm.type,
        externalLink: lessonForm.externalLink,
        videoDuration: lessonForm.videoDuration || undefined,
        videoFile: lessonForm.videoFile,
      });
      toast.success('Lesson added');
      setLessonForm({ title: '', type: 'VIDEO_UPLOAD', externalLink: '', videoFile: null, videoDuration: 0 });
    } catch (err) {
      toast.error(err.message || 'Failed to add lesson');
    }
  };

  const lessons = courseDetail?.lessons || [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Course Catalog"
        subtitle={canManage ? 'Browse, create and manage training courses' : 'Browse and enroll in available courses'}
        actions={canManage ? (
          <Button icon={Plus} onClick={openAdd}>Add Course</Button>
        ) : undefined}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-card" />)}
        </div>
      ) : courses.length === 0 ? (
        <Card className="py-8">
          <EmptyState
            icon={BookOpen}
            title="No courses yet"
            message={canManage ? 'Create your first training course to get started.' : 'Courses will appear here once HR publishes them.'}
            action={canManage ? <Button icon={Plus} onClick={openAdd}>Add Course</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((c) => {
            const completed = c.completedLessons ?? c.completed_lessons ?? 0;
            const total = c.totalLessons ?? c.total_lessons ?? c.lessonCount ?? 0;
            const pct = c.progressPercent ?? (total ? Math.round((completed / total) * 100) : 0);
            const enrolled = Boolean(c.enrollment);
            const depts = c.targetDepartments || c.departmentAccess || [];
            const isArchived = c.status === 'ARCHIVED' || c.isActive === false;

            return (
              <Card key={c.id} hover className="p-5 flex flex-col">
                <div className="h-24 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 overflow-hidden relative">
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <PlayCircle className="h-8 w-8" />
                  )}
                  {canManage && (
                    <div className="absolute top-2 right-2">
                      <StatusBadge status={isArchived ? 'archived' : 'active'} dot={false} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="primary">{humanize(c.category || 'general')}</Badge>
                  {canManage && total > 0 && (
                    <span className="text-xs text-fg-subtle">{total} lesson{total !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <p className="font-semibold text-fg mt-2">{c.title}</p>
                <p className="text-sm text-fg-muted mt-1 line-clamp-2">{stripHtml(c.description || '')}</p>
                {canManage && (
                  <p className="text-xs text-fg-subtle mt-1">
                    {depts.includes('all') ? 'All departments' : depts.join(', ')}
                  </p>
                )}
                {!canManage && enrolled && total > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-fg-subtle mb-1">{completed}/{total} lessons</p>
                    <ProgressBar value={pct} size="sm" />
                  </div>
                )}
                <div className="mt-auto pt-4 flex flex-wrap gap-2">
                  {canManage ? (
                    <>
                      <Button size="sm" variant="outline" className="min-w-0 flex-1 basis-[calc(50%-0.25rem)]" icon={ListVideo} onClick={() => setLessonsModal(c)}>
                        Lessons
                      </Button>
                      <Button size="sm" variant="outline" icon={Pencil} className="shrink-0" onClick={() => openEdit(c)} aria-label="Edit course" />
                      {!isArchived && (
                        <Button size="sm" variant="outline" icon={Archive} className="shrink-0" onClick={() => archiveCourseHandler(c.id)} aria-label="Archive course" />
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        icon={Trash2}
                        className="shrink-0 text-danger"
                        onClick={() => deleteCourseHandler(c.id, c.title)}
                        aria-label="Delete course"
                      />
                      <Button size="sm" className="min-w-0 flex-1 basis-[calc(50%-0.25rem)]" icon={Settings2} onClick={() => handleEnroll(c)}>
                        Preview
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="w-full" loading={enroll.isPending} onClick={() => handleEnroll(c)}>
                      {enrolled ? (c.enrollment?.status === 'COMPLETED' ? 'Review' : 'Continue') : 'Enroll'}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {canManage && (
        <>
          <CourseFormModal
            open={modal}
            onClose={() => setModal(false)}
            editing={editing}
            form={form}
            setForm={setForm}
            onSave={saveCourse}
            saving={createCourse.isPending || updateCourse.isPending}
          />
          <LessonsModal
            course={lessonsModal}
            onClose={() => setLessonsModal(null)}
            lessonForm={lessonForm}
            setLessonForm={setLessonForm}
            onVideoFile={onVideoFile}
            onSaveLesson={saveLesson}
            saving={addLesson.isPending}
            lessons={lessons}
          />
        </>
      )}
    </div>
  );
}
