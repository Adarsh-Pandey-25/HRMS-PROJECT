import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, PlayCircle, Plus, Pencil, Archive, Trash2, ListVideo, Settings2, ShieldAlert, CalendarClock } from 'lucide-react';
import {
  PageHeader, Card, Badge, EmptyState, Button, Skeleton, ProgressBar,
  Modal, Input, Select, SearchInput, RichTextEditor, StatusBadge, ConfirmDialog,
} from '../../components/ui';
import {
  useCourseCatalog, useManageCourses, useManageCourse, useTrainingMutations,
} from '../../hooks/useTraining';
import { useCan } from '../../hooks/useCan';
import { DEPARTMENTS } from '../../lib/constants';
import { stripHtml, humanize, formatDate, cn } from '../../lib/utils';
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
        <Input
          label="Category"
          placeholder="e.g. Compliance, Onboarding, Sales"
          hint="Shown on the course card and used to build the catalog filters."
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
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

const UNGROUPED = 'ungrouped';

/**
 * Lesson manager. Sections (chapters) are a grouping layer only — moving a
 * lesson between them never changes `lesson_order`, which is what decides the
 * order lessons unlock in for the employee. Sections are therefore listed in
 * the order their lessons play, and the numbering shown is the global lesson
 * order, not a per-section count, so it matches the player exactly.
 */
function LessonsModal({
  course, detail, onClose,
  lessonForm, setLessonForm, onVideoFile, onSaveLesson, saving,
  onAddChapter, onRenameChapter, onDeleteChapter, onMoveLesson, chapterBusy,
}) {
  const [newChapter, setNewChapter] = useState('');
  const sections = detail?.chapters || [];
  const chapterOptions = detail?.chapterOptions || [];
  const lessonNumber = new Map(
    (detail?.lessons || []).map((l, i) => [l.id, i + 1]),
  );

  const moveTargets = [
    { value: UNGROUPED, label: 'No section' },
    ...chapterOptions.map((c) => ({ value: c.id, label: c.title })),
  ];

  const addChapter = async () => {
    const title = newChapter.trim();
    if (!title) return;
    await onAddChapter(title);
    setNewChapter('');
  };

  return (
    <Modal
      open={Boolean(course)}
      onClose={onClose}
      title={`Lessons — ${course?.title || ''}`}
      size="lg"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5">
        <div className="space-y-4">
          {sections.length === 0 ? (
            <p className="text-sm text-fg-subtle">No lessons yet. Add the first lesson below.</p>
          ) : (
            sections.map((section) => (
              <div key={section.id} className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-sm font-semibold text-fg truncate">{section.title}</p>
                  {section.id !== UNGROUPED && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm" variant="outline" icon={Pencil} className="shrink-0"
                        aria-label={`Rename ${section.title}`}
                        onClick={() => onRenameChapter(section)}
                      />
                      <Button
                        size="sm" variant="outline" icon={Trash2} className="shrink-0 text-danger"
                        aria-label={`Delete ${section.title}`}
                        onClick={() => onDeleteChapter(section)}
                      />
                    </div>
                  )}
                </div>
                {section.lessons.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-fg-subtle">
                    No lessons in this section yet — move one here, or pick it when adding a lesson.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {section.lessons.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="text-fg min-w-0 truncate">
                          <span className="text-fg-subtle mr-2 tabular-nums">{lessonNumber.get(l.id) ?? '–'}.</span>
                          {l.title}
                          <span className="ml-2 text-xs text-fg-subtle">
                            {l.type === 'EXTERNAL_LINK' ? 'Link' : `Video · ${Math.round(l.videoDuration || 0)}s`}
                          </span>
                        </span>
                        <Select
                          className="h-8 w-40 shrink-0 text-xs"
                          aria-label={`Section for ${l.title}`}
                          value={l.chapterId || UNGROUPED}
                          disabled={chapterBusy}
                          options={moveTargets}
                          onChange={(e) => onMoveLesson(l.id, e.target.value)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}

          <div className="flex items-end gap-2">
            <Input
              label="New section"
              placeholder="e.g. Getting started"
              containerClass="flex-1"
              value={newChapter}
              onChange={(e) => setNewChapter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChapter(); } }}
            />
            <Button size="sm" variant="outline" icon={Plus} loading={chapterBusy} onClick={addChapter}>
              Add section
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            Sections only group lessons on screen. They never change the order lessons unlock in — that stays the order the lessons were added.
          </p>
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-semibold text-fg">Add lesson</p>
          <Input label="Lesson title" required value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
          {chapterOptions.length > 0 && (
            <Select
              label="Section"
              value={lessonForm.chapterId || UNGROUPED}
              options={moveTargets}
              onChange={(e) => setLessonForm({ ...lessonForm, chapterId: e.target.value })}
            />
          )}
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
  const {
    enroll, createCourse, updateCourse, deleteCourse, archiveCourse, addLesson,
    createChapter, updateChapter, deleteChapter, setLessonChapter,
  } = useTrainingMutations();

  const courses = canManage ? manageCourses : catalogCourses;
  const isLoading = canManage ? manageLoading : catalogLoading;

  const blankForm = { title: '', description: '', category: '', departmentAccess: ['all'] };
  const [modal, setModal] = useState(false);
  const [lessonsModal, setLessonsModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [lessonForm, setLessonForm] = useState({
    title: '', type: 'VIDEO_UPLOAD', externalLink: '', videoFile: null, videoDuration: 0, chapterId: '',
  });

  const { data: courseDetail } = useManageCourse(lessonsModal?.id);

  useEffect(() => {
    if (!lessonsModal) {
      setLessonForm({ title: '', type: 'VIDEO_UPLOAD', externalLink: '', videoFile: null, videoDuration: 0, chapterId: '' });
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

  /** Managers opening a course to look at it. Deliberately does not enrol —
   *  previewing someone else's training is not taking it. */
  const previewCourse = (course) => navigate(`/training/courses/${course.id}/play`);

  const openAdd = () => { setEditing(null); setForm(blankForm); setModal(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      title: c.title || '',
      description: c.description || '',
      category: c.category || '',
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

  const [confirmAction, setConfirmAction] = useState(null); // { type: 'archive' | 'delete', id, title }
  const [confirmBusy, setConfirmBusy] = useState(false);

  const archiveCourseHandler = (id) => setConfirmAction({ type: 'archive', id });
  const deleteCourseHandler = (id, title) => setConfirmAction({ type: 'delete', id, title });

  const runConfirmAction = async () => {
    const { type, id } = confirmAction;
    setConfirmBusy(true);
    try {
      if (type === 'archive') {
        await archiveCourse.mutateAsync(id);
        toast.success('Course archived');
      } else {
        await deleteCourse.mutateAsync(id);
        toast.success('Course deleted');
      }
      setConfirmAction(null);
    } catch (err) {
      toast.error(err.message || `Failed to ${type}`);
    } finally {
      setConfirmBusy(false);
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
        chapterId: lessonForm.chapterId && lessonForm.chapterId !== UNGROUPED ? lessonForm.chapterId : null,
      });
      toast.success('Lesson added');
      setLessonForm((f) => ({
        title: '', type: 'VIDEO_UPLOAD', externalLink: '', videoFile: null, videoDuration: 0,
        // Keep the section selected: adding several lessons to one section in
        // a row is the normal case, re-picking it each time is not.
        chapterId: f.chapterId,
      }));
    } catch (err) {
      toast.error(err.message || 'Failed to add lesson');
    }
  };

  const chapterBusy = createChapter.isPending || updateChapter.isPending
    || deleteChapter.isPending || setLessonChapter.isPending;

  const addChapterHandler = async (title) => {
    try {
      await createChapter.mutateAsync({ courseId: lessonsModal.id, title });
      toast.success(`Section "${title}" added`);
    } catch (err) {
      toast.error(err.message || 'Failed to add section');
    }
  };

  const [renaming, setRenaming] = useState(null); // { id, title }
  const renameChapterHandler = async () => {
    const title = renaming.title.trim();
    if (!title) return toast.error('Section name cannot be empty');
    try {
      await updateChapter.mutateAsync({ chapterId: renaming.id, title });
      setRenaming(null);
      toast.success('Section renamed');
    } catch (err) {
      toast.error(err.message || 'Failed to rename section');
    }
  };

  const [deletingChapter, setDeletingChapter] = useState(null);
  const confirmDeleteChapter = async () => {
    try {
      await deleteChapter.mutateAsync(deletingChapter.id);
      setDeletingChapter(null);
      toast.success('Section deleted — its lessons moved to Other lessons');
    } catch (err) {
      toast.error(err.message || 'Failed to delete section');
    }
  };

  const moveLessonHandler = async (lessonId, chapterId) => {
    try {
      await setLessonChapter.mutateAsync({
        lessonId,
        chapterId: chapterId === UNGROUPED ? null : chapterId,
      });
    } catch (err) {
      toast.error(err.message || 'Failed to move lesson');
    }
  };

  // ---- Catalog browsing: search + category + required-only ------------------
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [requiredOnly, setRequiredOnly] = useState(false);

  // Built from the categories actually in use, so the filter never offers one
  // that matches nothing and never needs a migration to extend.
  const categories = useMemo(() => {
    const seen = new Set();
    for (const c of courses) if (c.category) seen.add(c.category);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [courses]);

  const visibleCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((c) => {
      if (category !== 'all' && (c.category || '') !== category) return false;
      if (requiredOnly && !c.isMandatory) return false;
      if (!q) return true;
      const haystack = `${c.title || ''} ${stripHtml(c.description || '')} ${c.category || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [courses, search, category, requiredOnly]);

  const filtersActive = Boolean(search.trim()) || category !== 'all' || requiredOnly;
  const anyRequired = useMemo(() => courses.some((c) => c.isMandatory), [courses]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Course Catalog"
        subtitle={canManage ? 'Browse, create and manage training courses' : 'Browse and enroll in available courses'}
        actions={canManage ? (
          <Button icon={Plus} onClick={openAdd}>Add Course</Button>
        ) : undefined}
      />

      {!isLoading && courses.length > 0 && (
        <Card className="p-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search courses…"
            className="flex-1"
          />
          {categories.length > 0 && (
            <Select
              className="h-9 sm:w-48 text-sm"
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: humanize(c) }))]}
            />
          )}
          {anyRequired && (
            <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer shrink-0">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={requiredOnly}
                onChange={(e) => setRequiredOnly(e.target.checked)}
              />
              Required only
            </label>
          )}
        </Card>
      )}

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
      ) : visibleCourses.length === 0 ? (
        <Card className="py-8">
          <EmptyState
            icon={BookOpen}
            title="No courses match"
            message="Try a different search term or clear the filters."
            action={filtersActive ? (
              <Button
                variant="outline"
                onClick={() => { setSearch(''); setCategory('all'); setRequiredOnly(false); }}
              >
                Clear filters
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleCourses.map((c) => {
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
                  {c.isMandatory && <Badge tone="warning">Required</Badge>}
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
                {!canManage && c.deadline && (
                  <p className={cn(
                    'mt-2 inline-flex items-center gap-1 text-xs',
                    c.isOverdue ? 'font-medium text-danger' : 'text-fg-subtle',
                  )}>
                    {c.isOverdue ? <ShieldAlert className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                    {c.isOverdue ? `Overdue — was due ${formatDate(c.deadline)}` : `Due ${formatDate(c.deadline)}`}
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
                      <Button size="sm" className="min-w-0 flex-1 basis-[calc(50%-0.25rem)]" icon={Settings2} onClick={() => previewCourse(c)}>
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
            detail={courseDetail}
            onClose={() => setLessonsModal(null)}
            lessonForm={lessonForm}
            setLessonForm={setLessonForm}
            onVideoFile={onVideoFile}
            onSaveLesson={saveLesson}
            saving={addLesson.isPending}
            onAddChapter={addChapterHandler}
            onRenameChapter={(section) => setRenaming({ id: section.id, title: section.title })}
            onDeleteChapter={setDeletingChapter}
            onMoveLesson={moveLessonHandler}
            chapterBusy={chapterBusy}
          />

          <Modal
            open={Boolean(renaming)}
            onClose={() => setRenaming(null)}
            title="Rename section"
            footer={(
              <>
                <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
                <Button onClick={renameChapterHandler} loading={updateChapter.isPending}>Save</Button>
              </>
            )}
          >
            <Input
              label="Section name"
              required
              value={renaming?.title || ''}
              onChange={(e) => setRenaming((r) => ({ ...r, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renameChapterHandler(); } }}
            />
          </Modal>

          <ConfirmDialog
            open={Boolean(deletingChapter)}
            onClose={() => setDeletingChapter(null)}
            onConfirm={confirmDeleteChapter}
            loading={deleteChapter.isPending}
            tone="warning"
            title={`Delete section "${deletingChapter?.title || ''}"?`}
            message="Its lessons are kept — they move to Other lessons, and employee progress is unaffected."
            confirmLabel="Delete section"
          />
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={runConfirmAction}
        loading={confirmBusy}
        tone={confirmAction?.type === 'delete' ? 'danger' : 'warning'}
        title={confirmAction?.type === 'delete'
          ? `Permanently delete "${confirmAction?.title || 'this course'}"?`
          : 'Archive this course?'}
        message={confirmAction?.type === 'delete'
          ? 'This cannot be undone.'
          : 'Employees will no longer see it in the catalog.'}
        confirmLabel={confirmAction?.type === 'delete' ? 'Delete' : 'Archive'}
      />
    </div>
  );
}
