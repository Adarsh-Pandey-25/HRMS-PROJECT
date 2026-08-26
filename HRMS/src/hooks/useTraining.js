import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchEmployeeCoursesApi, fetchManageCoursesApi, fetchManageCourseApi,
  fetchCourseDetailApi, enrollCourseApi,
  createCourseApi, updateCourseApi, deleteCourseApi, archiveCourseApi, addCourseLessonApi,
  fetchEnrollmentsApi, createEnrollmentsApi, archiveEnrollmentApi,
  updateLessonProgressApi, fetchLessonVideoUrlApi,
  fetchTrainingProgressReportApi, sendTrainingReminderApi,
} from '../api/training.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useCourseCatalog() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['training', 'courses'], queryFn: fetchEmployeeCoursesApi, enabled: isAuthenticated });
}

export function useManageCourses(enabled = true) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'manage'],
    queryFn: fetchManageCoursesApi,
    enabled: isAuthenticated && enabled,
  });
}

export function useManageCourse(id) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'manage', id],
    queryFn: () => fetchManageCourseApi(id),
    enabled: isAuthenticated && Boolean(id),
  });
}

export function useCourseDetail(id) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'course', id],
    queryFn: () => fetchCourseDetailApi(id),
    enabled: isAuthenticated && Boolean(id),
  });
}

export function useEnrollments({ archivedOnly = false } = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'enrollments', archivedOnly ? 'archived' : 'active'],
    queryFn: () => fetchEnrollmentsApi({ archivedOnly }),
    enabled: isAuthenticated,
  });
}

export function useArchivedEnrollmentCount() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'enrollments', 'archived-count'],
    queryFn: async () => {
      const rows = await fetchEnrollmentsApi({ archivedOnly: true });
      return rows.length;
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

export function useTrainingProgressReport() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'progress-report'],
    queryFn: fetchTrainingProgressReportApi,
    enabled: isAuthenticated,
  });
}

export function useTrainingMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['training']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    enroll: useMutation({ mutationFn: enrollCourseApi, onSuccess: invalidate }),
    createCourse: useMutation({ mutationFn: createCourseApi, onSuccess: invalidate }),
    updateCourse: useMutation({ mutationFn: ({ id, payload }) => updateCourseApi(id, payload), onSuccess: invalidate }),
    deleteCourse: useMutation({
      mutationFn: deleteCourseApi,
      onSuccess: async (_data, id) => {
        // Drop from cached lists immediately so the card disappears without a full reload.
        qc.setQueriesData({ queryKey: ['training', 'manage'] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.filter((c) => String(c.id) !== String(id));
        });
        qc.setQueriesData({ queryKey: ['training', 'courses'] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.filter((c) => String(c.id) !== String(id));
        });
        await invalidate();
      },
    }),
    archiveCourse: useMutation({ mutationFn: archiveCourseApi, onSuccess: invalidate }),
    addLesson: useMutation({
      mutationFn: ({ courseId, ...rest }) => addCourseLessonApi(courseId, rest),
      onSuccess: invalidate,
    }),
    createEnrollments: useMutation({
      mutationFn: ({ courseId, employeeIds, deadline }) => createEnrollmentsApi(courseId, employeeIds, deadline),
      onSuccess: invalidate,
    }),
    archiveEnrollment: useMutation({
      mutationFn: archiveEnrollmentApi,
      onSuccess: invalidate,
    }),
    updateProgress: useMutation({
      mutationFn: ({ lessonId, watchedSeconds, forceComplete }) => updateLessonProgressApi(lessonId, watchedSeconds, { forceComplete }),
      onSuccess: invalidate,
    }),
    sendReminder: useMutation({ mutationFn: sendTrainingReminderApi }),
  };
}

export function useLessonVideoUrl(lessonId) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['training', 'video', lessonId],
    queryFn: () => fetchLessonVideoUrlApi(lessonId),
    enabled: isAuthenticated && Boolean(lessonId),
  });
}
