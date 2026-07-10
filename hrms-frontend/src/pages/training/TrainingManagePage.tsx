import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  addChapter,
  addLesson,
  createCourse,
  deleteCourse,
  fetchDepartments,
  fetchManageCourse,
  fetchManageCourses,
  updateCourse,
} from '../../lib/training.api'
import { getErrorMessage } from '../../lib/errors'
import {
  Badge,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Textarea,
} from '../../components/ui'
import type { Course, CourseChapter } from '../../types'

type LessonForm = {
  title: string
  type: 'VIDEO_UPLOAD' | 'EXTERNAL_LINK'
  externalLink: string
  videoDuration: string
  videoFile: File | null
}

const emptyLesson = (): LessonForm => ({
  title: '',
  type: 'VIDEO_UPLOAD',
  externalLink: '',
  videoDuration: '',
  videoFile: null,
})

export default function TrainingManagePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const durationVideoRef = useRef<HTMLVideoElement>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [courseForm, setCourseForm] = useState({ title: '', description: '', targetDepartments: [] as string[] })
  const [thumbnail, setThumbnail] = useState<File | null>(null)
  const [showNewCourse, setShowNewCourse] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>({})
  const [lessonModal, setLessonModal] = useState<{ chapterId: string; order: number } | null>(null)
  const [lessonForm, setLessonForm] = useState<LessonForm>(emptyLesson())
  const [uploading, setUploading] = useState(false)

  const courses = useQuery({ queryKey: ['courses', 'manage'], queryFn: fetchManageCourses })
  const departments = useQuery({ queryKey: ['training', 'departments'], queryFn: fetchDepartments })

  const selected = useQuery({
    queryKey: ['courses', 'manage', selectedId],
    queryFn: () => fetchManageCourse(selectedId!),
    enabled: Boolean(selectedId),
  })

  useEffect(() => {
    if (selected.data) {
      setCourseForm({
        title: selected.data.title,
        description: selected.data.description || '',
        targetDepartments: selected.data.targetDepartments || [],
      })
      const open: Record<string, boolean> = {}
      for (const ch of selected.data.chapters || []) open[ch.id] = true
      setOpenChapters(open)
    }
  }, [selected.data?.id])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['courses'] })
    if (selectedId) qc.invalidateQueries({ queryKey: ['courses', 'manage', selectedId] })
  }

  const create = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('title', courseForm.title)
      fd.append('description', courseForm.description)
      fd.append('targetDepartments', JSON.stringify(courseForm.targetDepartments))
      if (thumbnail) fd.append('thumbnail', thumbnail)
      return createCourse(fd)
    },
    onSuccess: (data) => {
      toast.success('Course created')
      invalidate()
      setShowNewCourse(false)
      setSelectedId(data.id)
      setCourseForm({ title: '', description: '', targetDepartments: [] })
      setThumbnail(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const saveCourse = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('title', courseForm.title)
      fd.append('description', courseForm.description)
      fd.append('targetDepartments', JSON.stringify(courseForm.targetDepartments))
      if (thumbnail) fd.append('thumbnail', thumbnail)
      return updateCourse(selectedId!, fd)
    },
    onSuccess: () => {
      toast.success('Course saved')
      invalidate()
      setThumbnail(null)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const removeCourse = useMutation({
    mutationFn: () => deleteCourse(selectedId!),
    onSuccess: () => {
      toast.success('Course deleted')
      setSelectedId(null)
      invalidate()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const addChapterMut = useMutation({
    mutationFn: () => {
      const order = (selected.data?.chapters?.length || 0) + 1
      return addChapter(selectedId!, { title: chapterTitle, order })
    },
    onSuccess: () => {
      toast.success('Chapter added')
      setChapterTitle('')
      invalidate()
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const addLessonMut = useMutation({
    mutationFn: async () => {
      if (!lessonModal) return
      setUploading(true)
      const fd = new FormData()
      fd.append('title', lessonForm.title)
      fd.append('order', String(lessonModal.order))
      fd.append('type', lessonForm.type)
      fd.append('videoDuration', lessonForm.videoDuration)
      if (lessonForm.type === 'EXTERNAL_LINK') {
        fd.append('externalLink', lessonForm.externalLink)
      } else if (lessonForm.videoFile) {
        fd.append('video', lessonForm.videoFile)
      }
      return addLesson(lessonModal.chapterId, fd)
    },
    onSuccess: () => {
      toast.success('Lesson added')
      setLessonModal(null)
      setLessonForm(emptyLesson())
      setUploading(false)
      invalidate()
    },
    onError: (e) => {
      setUploading(false)
      toast.error(getErrorMessage(e))
    },
  })

  const onVideoFile = (file: File | null) => {
    setLessonForm((p) => ({ ...p, videoFile: file }))
    if (!file) return
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      setLessonForm((p) => ({ ...p, videoDuration: String(Math.round(video.duration)) }))
    }
    video.src = url
  }

  const toggleDept = (dept: string) => {
    setCourseForm((p) => ({
      ...p,
      targetDepartments: p.targetDepartments.includes(dept)
        ? p.targetDepartments.filter((d) => d !== dept)
        : [...p.targetDepartments, dept],
    }))
  }

  const courseList: Course[] = courses.data || []
  const chapters: CourseChapter[] = selected.data?.chapters || []

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-4rem)] flex flex-col">
      <PageHeader
        title="Manage Courses"
        description="Build courses with chapters, video lessons, and department targeting"
        action={<Button variant="secondary" onClick={() => navigate('/training')}>Back to Catalog</Button>}
      />

      <div className="flex flex-1 gap-4 min-h-0">
        <Card className="w-72 shrink-0 flex flex-col">
          <CardBody className="flex flex-col gap-3 flex-1 min-h-0 p-4">
            <Button className="w-full gap-1" onClick={() => setShowNewCourse(true)}>
              <Plus className="h-4 w-4" /> Add Course
            </Button>
            <div className="flex-1 overflow-y-auto space-y-1">
              {courses.isLoading ? <LoadingState /> : courseList.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                    selectedId === c.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-slate-50'
                  }`}
                >
                  <div>{c.title}</div>
                  {c.targetDepartments?.length ? (
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{c.targetDepartments.join(', ')}</div>
                  ) : (
                    <div className="text-xs text-amber-600 mt-0.5">No departments</div>
                  )}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="flex-1 min-h-0 overflow-hidden">
          <CardBody className="h-full overflow-y-auto space-y-6">
            {!selectedId ? (
              <p className="text-slate-500 text-center py-20">Select a course or create a new one</p>
            ) : selected.isLoading ? <LoadingState /> : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Course Details</h2>
                  <Button variant="danger" size="sm" onClick={() => removeCourse.mutate()} disabled={removeCourse.isPending}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 max-w-2xl">
                  <Field label="Title">
                    <Input value={courseForm.title} onChange={(e) => setCourseForm((p) => ({ ...p, title: e.target.value }))} />
                  </Field>
                  <Field label="Description">
                    <Textarea value={courseForm.description} onChange={(e) => setCourseForm((p) => ({ ...p, description: e.target.value }))} />
                  </Field>
                  <Field label="Cover image">
                    <Input type="file" accept="image/*" onChange={(e) => setThumbnail(e.target.files?.[0] || null)} />
                  </Field>
                  <Field label="Target departments">
                    <p className="text-xs text-slate-500 mb-2">Employees only see courses assigned to their department. Select all departments that should access this course.</p>
                    {courseForm.targetDepartments.length ? (
                      <p className="text-xs text-primary font-medium mb-2">
                        Selected: {courseForm.targetDepartments.join(', ')}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 mb-2">No department selected — no employees will see this course.</p>
                    )}
                    <div className="flex flex-wrap gap-2 border rounded-lg p-3 min-h-[80px]">
                      {(departments.data || []).map((dept) => (
                        <button
                          key={dept}
                          type="button"
                          onClick={() => toggleDept(dept)}
                          className={`px-3 py-1 rounded-full text-xs border ${
                            courseForm.targetDepartments.includes(dept)
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-slate-600'
                          }`}
                        >
                          {dept}
                        </button>
                      ))}
                      {!departments.data?.length ? <span className="text-sm text-slate-400">No departments found in employee records</span> : null}
                    </div>
                  </Field>
                  <Button onClick={() => saveCourse.mutate()} disabled={saveCourse.isPending}>Save Course</Button>
                </div>

                <div className="border-t pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Curriculum</h3>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Chapter title"
                        value={chapterTitle}
                        onChange={(e) => setChapterTitle(e.target.value)}
                        className="w-48"
                      />
                      <Button size="sm" onClick={() => addChapterMut.mutate()} disabled={!chapterTitle || addChapterMut.isPending}>
                        Add Chapter
                      </Button>
                    </div>
                  </div>

                  {chapters.map((chapter) => (
                    <div key={chapter.id} className="border rounded-xl overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left font-medium"
                        onClick={() => setOpenChapters((p) => ({ ...p, [chapter.id]: !p[chapter.id] }))}
                      >
                        {openChapters[chapter.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {chapter.title}
                        <Badge status="active">{chapter.lessons?.length || 0} lessons</Badge>
                      </button>
                      {openChapters[chapter.id] ? (
                        <div className="p-4 space-y-2">
                          {(chapter.lessons || []).map((lesson) => (
                            <div key={lesson.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white border">
                              <span className="text-sm">{lesson.title}</span>
                              <span className="text-xs text-slate-500">
                                {lesson.type === 'VIDEO_UPLOAD' ? 'Video' : 'Link'}
                                {lesson.videoDuration ? ` · ${Math.round(lesson.videoDuration / 60)}m` : ''}
                              </span>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setLessonModal({ chapterId: chapter.id, order: (chapter.lessons?.length || 0) + 1 })
                              setLessonForm(emptyLesson())
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add Lesson
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal open={showNewCourse} title="New Course" onClose={() => setShowNewCourse(false)}>
        <div className="space-y-4">
          <Field label="Title"><Input value={courseForm.title} onChange={(e) => setCourseForm((p) => ({ ...p, title: e.target.value }))} /></Field>
          <Field label="Description"><Textarea value={courseForm.description} onChange={(e) => setCourseForm((p) => ({ ...p, description: e.target.value }))} /></Field>
          <Field label="Departments">
            <div className="flex flex-wrap gap-2">
              {(departments.data || []).map((dept) => (
                <button key={dept} type="button" onClick={() => toggleDept(dept)} className={`px-3 py-1 rounded-full text-xs border ${courseForm.targetDepartments.includes(dept) ? 'bg-primary text-white' : ''}`}>{dept}</button>
              ))}
            </div>
          </Field>
          <Field label="Thumbnail"><Input type="file" accept="image/*" onChange={(e) => setThumbnail(e.target.files?.[0] || null)} /></Field>
          <Button className="w-full" onClick={() => create.mutate()} disabled={!courseForm.title || create.isPending}>Create Course</Button>
        </div>
      </Modal>

      <Modal open={Boolean(lessonModal)} title="Add Lesson" onClose={() => setLessonModal(null)}>
        <div className="space-y-4">
          <Field label="Lesson title">
            <Input value={lessonForm.title} onChange={(e) => setLessonForm((p) => ({ ...p, title: e.target.value }))} />
          </Field>
          <Field label="Content type">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={lessonForm.type === 'VIDEO_UPLOAD'} onChange={() => setLessonForm((p) => ({ ...p, type: 'VIDEO_UPLOAD' }))} />
                Upload Video
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={lessonForm.type === 'EXTERNAL_LINK'} onChange={() => setLessonForm((p) => ({ ...p, type: 'EXTERNAL_LINK' }))} />
                Paste Link
              </label>
            </div>
          </Field>
          {lessonForm.type === 'VIDEO_UPLOAD' ? (
            <Field label="Video file">
              <Input type="file" accept="video/*" onChange={(e) => onVideoFile(e.target.files?.[0] || null)} />
              <p className="text-xs text-slate-500 mt-1">Max 50 MB per video (mp4, webm, mov). For larger files, use Paste Link.</p>
              {uploading ? <p className="text-xs text-slate-500 mt-1">Uploading video…</p> : null}
              <video ref={durationVideoRef} className="hidden" />
            </Field>
          ) : (
            <Field label="Video URL (YouTube / Vimeo)">
              <Input value={lessonForm.externalLink} onChange={(e) => setLessonForm((p) => ({ ...p, externalLink: e.target.value }))} placeholder="https://..." />
            </Field>
          )}
          <Field label="Duration (seconds)">
            <Input
              type="number"
              value={lessonForm.videoDuration}
              onChange={(e) => setLessonForm((p) => ({ ...p, videoDuration: e.target.value }))}
              placeholder={lessonForm.type === 'EXTERNAL_LINK' ? 'Estimated watch time' : 'Auto-detected from upload'}
            />
          </Field>
          <Button
            className="w-full"
            onClick={() => addLessonMut.mutate()}
            disabled={!lessonForm.title || !lessonForm.videoDuration || uploading || addLessonMut.isPending}
          >
            {uploading ? 'Uploading…' : 'Add Lesson'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
