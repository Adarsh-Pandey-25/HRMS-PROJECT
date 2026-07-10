import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, PlayCircle } from 'lucide-react'
import { toast } from 'sonner'
import { authStore } from '../../store/auth'
import { isManagerOrAbove } from '../../lib/permissions'
import { enrollCourse, fetchEmployeeCourses } from '../../lib/training.api'
import { getErrorMessage } from '../../lib/errors'
import { Badge, Button, Card, CardBody, LoadingState, PageHeader } from '../../components/ui'
import type { Course } from '../../types'

const TrainingProgressPage = lazy(() => import('./TrainingProgressPage'))

export default function TrainingPage() {
  const me = authStore((s) => s.me)

  if (isManagerOrAbove(me?.role)) {
    return (
      <Suspense fallback={<div className="p-6"><LoadingState /></div>}>
        <TrainingProgressPage />
      </Suspense>
    )
  }

  return <EmployeeTrainingCatalog />
}

function EmployeeTrainingCatalog() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const courses = useQuery({
    queryKey: ['courses', 'employee'],
    queryFn: fetchEmployeeCourses,
    staleTime: 2 * 60_000,
  })

  const enroll = useMutation({
    mutationFn: enrollCourse,
    onSuccess: (_, courseId) => {
      qc.invalidateQueries({ queryKey: ['courses'] })
      navigate(`/training/course/${courseId}`)
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  })

  const rows: Course[] = courses.data || []
  const me = authStore((s) => s.me)

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Training"
        description="Learn at your own pace — courses assigned to your department"
      />

      {courses.isLoading ? <LoadingState /> : rows.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((course) => (
            <Card key={course.id} className="overflow-hidden hover:shadow-md transition-shadow">
              <div className="aspect-video bg-slate-100 relative">
                {course.thumbnailUrl ? (
                  <img src={course.thumbnailUrl} alt={course.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    <BookOpen className="h-12 w-12" />
                  </div>
                )}
                {course.progressPercent ? (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-200">
                    <div className="h-full bg-primary" style={{ width: `${course.progressPercent}%` }} />
                  </div>
                ) : null}
              </div>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 line-clamp-2">{course.title}</h3>
                  {course.enrollment?.status === 'COMPLETED' ? (
                    <Badge status="completed">Done</Badge>
                  ) : course.enrollment ? (
                    <Badge status="in_progress">{course.progressPercent || 0}%</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-slate-600 line-clamp-2">{course.description || 'No description'}</p>
                <p className="text-xs text-slate-500">{course.totalLessons || 0} lessons</p>
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    if (course.enrollment) {
                      navigate(`/training/course/${course.id}`)
                    } else {
                      enroll.mutate(course.id)
                    }
                  }}
                  disabled={enroll.isPending}
                >
                  <PlayCircle className="h-4 w-4" />
                  {course.enrollment ? 'Continue Course' : 'Go to Course'}
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardBody className="py-16 text-center text-slate-500">
            No courses available for your department ({me?.department || 'not set'}) yet.
          </CardBody>
        </Card>
      )}
    </div>
  )
}
