import api from './api'
import type { Course, CourseChapter, Lesson, LessonProgress } from '../types'

export const fetchTrainingProgressReport = () =>
  api.get('/training/progress-report').then((r) => r.data.data as TrainingProgressReport)

export type EmployeeCourseProgress = {
  courseId: string
  courseTitle: string
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
  progressPercent: number
  totalLessons: number
  completedLessons: number
  enrolledAt?: string | null
  completedAt?: string | null
}

export type EmployeeTrainingProgress = {
  employeeId: string
  firstName: string
  lastName: string
  email: string
  department?: string
  employeeCode?: string
  assignedCount: number
  completedCount: number
  courses: EmployeeCourseProgress[]
}

export type TrainingProgressReport = {
  summary: {
    employeeCount: number
    courseCount: number
    totalAssignments: number
    completedAssignments: number
    inProgressAssignments: number
    notStartedAssignments: number
  }
  employees: EmployeeTrainingProgress[]
}

export const fetchDepartments = () =>
  api.get('/training/departments').then((r) => r.data.data as string[])

export const fetchManageCourses = () =>
  api.get('/training/courses/manage').then((r) => r.data.data as Course[])

export const fetchManageCourse = (id: string) =>
  api.get(`/training/courses/manage/${id}`).then((r) => r.data.data as Course)

export const fetchEmployeeCourses = () =>
  api.get('/training/courses').then((r) => r.data.data as Course[])

export const fetchCourse = (id: string) =>
  api.get(`/training/courses/${id}`).then((r) => r.data.data as Course)

export const createCourse = (form: FormData) =>
  api.post('/training/courses', form).then((r) => r.data.data as Course)

export const updateCourse = (id: string, form: FormData) =>
  api.put(`/training/courses/${id}`, form).then((r) => r.data.data as Course)

export const deleteCourse = (id: string) =>
  api.delete(`/training/courses/${id}`)

export const addChapter = (courseId: string, body: { title: string; order: number }) =>
  api.post(`/training/courses/${courseId}/chapters`, body).then((r) => r.data.data as CourseChapter)

export const addLesson = (chapterId: string, form: FormData) =>
  api.post(`/training/chapters/${chapterId}/lessons`, form).then((r) => r.data.data as Lesson)

export const enrollCourse = (courseId: string) =>
  api.post(`/training/courses/${courseId}/enroll`).then((r) => r.data.data)

export const updateLessonProgress = (lessonId: string, watchedSeconds: number) =>
  api.post(`/training/lessons/${lessonId}/progress`, { watchedSeconds }).then((r) => r.data.data as LessonProgressUpdate)

export const fetchLessonVideoUrl = (lessonId: string) =>
  api.get(`/training/lessons/${lessonId}/video-url`).then((r) => r.data.data.videoUrl as string)

export type LessonProgressUpdate = {
  lessonId: string
  enrollmentId: string
  watchedSeconds: number
  isCompleted: boolean
  courseId: string
  enrollmentStatus: string
  completedAt?: string | null
}

export function parseYouTubeVideoId(url: string): string | null {
  try {
    if (url.includes('youtube.com/watch')) {
      return new URL(url).searchParams.get('v')
    }
    if (url.includes('youtu.be/')) {
      return url.split('youtu.be/')[1]?.split('?')[0] || null
    }
    if (url.includes('youtube.com/embed/')) {
      return url.split('youtube.com/embed/')[1]?.split('?')[0] || null
    }
  } catch {
    return null
  }
  return null
}

export function parseVimeoVideoId(url: string): string | null {
  try {
    if (url.includes('vimeo.com/')) {
      return url.split('vimeo.com/')[1]?.split('?')[0] || null
    }
  } catch {
    return null
  }
  return null
}

export function toEmbedUrl(url: string): string {
  try {
    if (url.includes('youtube.com/watch')) {
      const id = new URL(url).searchParams.get('v')
      return id ? `https://www.youtube.com/embed/${id}?rel=0` : url
    }
    if (url.includes('youtu.be/')) {
      const id = url.split('youtu.be/')[1]?.split('?')[0]
      return id ? `https://www.youtube.com/embed/${id}?rel=0` : url
    }
    if (url.includes('vimeo.com/')) {
      const id = url.split('vimeo.com/')[1]?.split('?')[0]
      return id ? `https://player.vimeo.com/video/${id}` : url
    }
  } catch {
    return url
  }
  return url
}

export function flattenLessons(chapters: CourseChapter[] = []): Lesson[] {
  return chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((ch) =>
      (ch.lessons || [])
        .slice()
        .sort((a, b) => a.order - b.order),
    )
}

export function isLessonLocked(
  lesson: Lesson,
  allLessons: Lesson[],
  progressMap: Map<string, LessonProgress>,
): boolean {
  const idx = allLessons.findIndex((l) => l.id === lesson.id)
  if (idx <= 0) return false
  const prev = allLessons[idx - 1]
  return !progressMap.get(prev.id)?.isCompleted
}
