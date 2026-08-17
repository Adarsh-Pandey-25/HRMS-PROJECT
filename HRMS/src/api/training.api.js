import { apiRequest, apiUpload } from './client';
import { toCamelCase } from '../lib/case';

export async function fetchMyTrainingsApi() {
  const rows = await apiRequest({ method: 'GET', url: '/training/my-trainings' });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchAllTrainingsApi(params = {}) {
  const rows = await apiRequest({ method: 'GET', url: '/training/all-trainings', params });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchEmployeeCoursesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/training/catalog' });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchManageCoursesApi() {
  const rows = await apiRequest({ method: 'GET', url: '/training/courses/manage' });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function fetchManageCourseApi(id) {
  const data = await apiRequest({ method: 'GET', url: `/training/courses/manage/${id}` });
  return toCamelCase(data);
}

export async function fetchCourseDetailApi(id) {
  const data = await apiRequest({ method: 'GET', url: `/training/courses/${id}` });
  return toCamelCase(data);
}

export async function enrollCourseApi(courseId) {
  const data = await apiRequest({ method: 'POST', url: `/training/courses/${courseId}/enroll` });
  return toCamelCase(data);
}

export async function createCourseApi(payload) {
  const data = await apiRequest({
    method: 'POST',
    url: '/training/courses',
    data: {
      title: payload.title,
      description: payload.description,
      target_departments: payload.targetDepartments || payload.departmentAccess || ['all'],
      status: payload.status || 'ACTIVE',
    },
  });
  return toCamelCase(data);
}

export async function updateCourseApi(id, payload) {
  const data = await apiRequest({
    method: 'PUT',
    url: `/training/courses/${id}`,
    data: {
      title: payload.title,
      description: payload.description,
      target_departments: payload.targetDepartments || payload.departmentAccess,
      is_active: payload.status !== 'archived' && payload.status !== 'ARCHIVED',
      status: payload.status === 'archived' || payload.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    },
  });
  return toCamelCase(data);
}

export async function deleteCourseApi(id) {
  return apiRequest({ method: 'DELETE', url: `/training/courses/${id}` });
}

export async function archiveCourseApi(id) {
  return apiRequest({ method: 'POST', url: `/training/courses/${id}/archive` });
}

/** Add lesson: VIDEO_UPLOAD (multipart) or EXTERNAL_LINK (JSON). */
export async function addCourseLessonApi(courseId, { title, type, externalLink, videoDuration, order, videoFile }) {
  if (type === 'VIDEO_UPLOAD' && videoFile) {
    const form = new FormData();
    form.append('title', title);
    form.append('type', 'VIDEO_UPLOAD');
    form.append('videoDuration', String(videoDuration || 0));
    if (order) form.append('order', String(order));
    form.append('video', videoFile);
    const data = await apiUpload({ method: 'POST', url: `/training/courses/${courseId}/lessons`, data: form });
    return toCamelCase(data);
  }
  const data = await apiRequest({
    method: 'POST',
    url: `/training/courses/${courseId}/lessons`,
    data: {
      title,
      type: 'EXTERNAL_LINK',
      external_link: externalLink,
      externalLink,
      video_duration: videoDuration,
      videoDuration,
      order,
    },
  });
  return toCamelCase(data);
}

export async function fetchEnrollmentsApi({ archivedOnly = false, includeArchived = false } = {}) {
  const params = {};
  if (archivedOnly) params.archivedOnly = 'true';
  else if (includeArchived) params.includeArchived = 'true';
  const rows = await apiRequest({ method: 'GET', url: '/training/enrollments', params });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}

export async function createEnrollmentsApi(courseId, employeeIds) {
  const data = await apiRequest({
    method: 'POST',
    url: '/training/enrollments',
    data: { course_id: courseId, employee_ids: employeeIds },
  });
  return toCamelCase(data);
}

export async function updateLessonProgressApi(lessonId, watchedSeconds, { forceComplete = false } = {}) {
  const data = await apiRequest({
    method: 'POST',
    url: `/training/lessons/${lessonId}/progress`,
    data: { watchedSeconds, forceComplete },
  });
  return toCamelCase(data);
}

export async function fetchLessonVideoUrlApi(lessonId) {
  const data = await apiRequest({ method: 'GET', url: `/training/lessons/${lessonId}/video-url` });
  return toCamelCase(data);
}

export async function archiveEnrollmentApi(id) {
  const data = await apiRequest({ method: 'PUT', url: `/training/enrollments/${id}/archive` });
  return toCamelCase(data);
}

export async function fetchTrainingProgressReportApi() {
  const data = await apiRequest({ method: 'GET', url: '/training/progress-report' });
  return toCamelCase(data);
}

export async function assignTrainingApi(trainingId, employeeIds) {
  return apiRequest({
    method: 'POST',
    url: '/training/assign',
    data: { training_id: trainingId, employee_ids: employeeIds },
  });
}

export async function fetchTrainingParticipantsApi(trainingId) {
  const rows = await apiRequest({ method: 'GET', url: `/training/${trainingId}/participants` });
  return Array.isArray(rows) ? rows.map((r) => toCamelCase(r)) : [];
}
