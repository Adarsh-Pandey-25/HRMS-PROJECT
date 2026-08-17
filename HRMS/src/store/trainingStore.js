import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { courses as courseSeed, myEnrollments as enrollmentSeed } from '../data';

// Shared course/enrollment state across all Training sub-pages (Catalog, My
// Trainings, New Joiner Training, Manage Courses, Enrollments) now that each
// is a standalone routed page rather than a tab within one component.
// Persisted so enrollments/progress survive a page reload in this demo.
export const useTrainingStore = create(
  persist(
    (set, get) => ({
      courses: courseSeed,
      enrollments: enrollmentSeed,

      myEnrollmentFor: (employeeId, courseId) => get().enrollments.find((e) => e.employeeId === employeeId && e.courseId === courseId),

      enrollOrContinue: (employeeId, course) => {
        const existing = get().myEnrollmentFor(employeeId, course.id);
        if (existing) return 'resumed';
        set((s) => ({
          enrollments: [
            ...s.enrollments,
            { id: `ENR-${Math.random().toString(36).slice(2, 7)}`, courseId: course.id, employeeId, enrolledOn: '2026-07-08', progress: 10, completedOn: null, score: null, certificateUrl: null, isOverdue: false, deadline: null },
          ],
        }));
        return 'started';
      },

      markComplete: (employeeId, courseId) =>
        set((s) => {
          const exists = s.enrollments.find((e) => e.employeeId === employeeId && e.courseId === courseId);
          if (exists) {
            return { enrollments: s.enrollments.map((e) => (e.employeeId === employeeId && e.courseId === courseId ? { ...e, progress: 100, completedOn: '2026-07-08', isOverdue: false } : e)) };
          }
          return {
            enrollments: [...s.enrollments, { id: `ENR-${Math.random().toString(36).slice(2, 7)}`, courseId, employeeId, enrolledOn: '2026-07-08', progress: 100, completedOn: '2026-07-08', score: null, certificateUrl: '#', isOverdue: false, deadline: null }],
          };
        }),

      addCourse: (course) => set((s) => ({ courses: [...s.courses, { id: `TRN-${String(s.courses.length + 1).padStart(3, '0')}`, createdBy: 'EMP-0001', createdAt: new Date().toISOString(), thumbnailUrl: null, videoUploadUrl: null, ...course }] })),
      updateCourse: (id, patch) => set((s) => ({ courses: s.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      archiveCourse: (id) => set((s) => ({ courses: s.courses.map((c) => (c.id === id ? { ...c, status: 'archived' } : c)) })),

      assignEnrollments: (courseId, employeeIds, deadline) =>
        set((s) => {
          const newEnr = employeeIds
            .filter((empId) => !s.enrollments.some((e) => e.employeeId === empId && e.courseId === courseId))
            .map((empId) => ({ id: `ENR-${Math.random().toString(36).slice(2, 7)}`, courseId, employeeId: empId, enrolledOn: '2026-07-08', progress: 0, completedOn: null, score: null, certificateUrl: null, isOverdue: false, deadline: deadline || null }));
          return { enrollments: [...s.enrollments, ...newEnr] };
        }),
    }),
    { name: 'zenith-training' }
  )
);
