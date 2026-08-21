import { apiRequest, apiRequestPaginated } from './client';
import { mapAttendanceFromApi, mapTodayStatusFromApi, mapLast7DaysFromApi } from '../lib/mappers';
import { toSnakeCase } from '../lib/case';

export async function checkInApi(body = {}) {
  const data = await apiRequest({ method: 'POST', url: '/attendance/check-in', data: { method: 'web', ...body } });
  return mapAttendanceFromApi(data);
}

export async function checkOutApi(body = {}) {
  const data = await apiRequest({ method: 'POST', url: '/attendance/check-out', data: { method: 'web', ...body } });
  return mapAttendanceFromApi(data);
}

export async function fetchCheckContextApi() {
  const data = await apiRequest({ method: 'GET', url: '/attendance/check-context' });
  const today = data?.today ? mapAttendanceFromApi(data.today) : null;
  return {
    ...data,
    dailyWfhStatus: data?.dailyWfhStatus ?? data?.daily_wfh_status ?? null,
    dailyWfhApproved: Boolean(data?.dailyWfhApproved ?? data?.daily_wfh_approved),
    dailyWfhRequestId: data?.dailyWfhRequestId ?? data?.daily_wfh_request_id ?? null,
    canCheckInAsWfh: Boolean(data?.canCheckInAsWfh ?? data?.can_check_in_as_wfh),
    today: today
      ? {
          ...today,
          isOpen: Boolean(data.today.is_open ?? data.today.isOpen ?? (today.checkIn && !today.checkOut)),
          checkedIn: Boolean(data.today.checked_in ?? data.today.checkedIn ?? today.checkIn),
          checkedOut: Boolean(data.today.checked_out ?? data.today.checkedOut ?? today.checkOut),
        }
      : null,
  };
}

export async function requestWfhDayApi(body = {}) {
  return apiRequest({ method: 'POST', url: '/attendance/wfh-requests', data: body });
}

export async function cancelWfhDayApi(id) {
  return apiRequest({ method: 'DELETE', url: `/attendance/wfh-requests/${id}` });
}

export async function fetchMyWfhRequestsApi(params = {}) {
  const { items } = await apiRequestPaginated({
    method: 'GET',
    url: '/attendance/wfh-requests/mine',
    params: { limit: 50, ...params },
  });
  return items;
}

export async function fetchPendingWfhRequestsApi(params = {}) {
  const { items } = await apiRequestPaginated({
    method: 'GET',
    url: '/attendance/wfh-requests/pending',
    params: { limit: 100, status: 'pending', ...params },
  });
  return items;
}

export async function reviewWfhRequestApi(id, body) {
  return apiRequest({ method: 'PUT', url: `/attendance/wfh-requests/${id}/review`, data: body });
}

export async function fetchMyAttendanceApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/attendance/my-attendance', params: { limit: 100, ...params } });
  return items.map(mapAttendanceFromApi);
}

export async function fetchTeamAttendanceApi(params = {}) {
  const { items } = await apiRequestPaginated({
    method: 'GET',
    url: '/attendance/team-attendance',
    params: { limit: 500, ...params },
  });
  return items.map(mapAttendanceFromApi);
}

export async function fetchAllAttendanceApi(params = {}) {
  const { items } = await apiRequestPaginated({
    method: 'GET',
    url: '/attendance/all-attendance',
    params: { limit: 500, ...params },
  });
  return items.map(mapAttendanceFromApi);
}

export async function fetchMonthlySummaryApi(params = {}) {
  const data = await apiRequest({ method: 'GET', url: '/attendance/monthly-summary', params });
  return {
    records: (data?.records || []).map(mapAttendanceFromApi),
    summary: mapAttendanceSummaryFromApi(data),
  };
}

function mapAttendanceSummaryFromApi(data) {
  const summary = data?.summary || {};
  const avgFromApi = summary.avgHours;
  const totalDays = Number(summary.totalDays || 0);
  const totalHours = Number(summary.totalHours || 0);
  return {
    present: Number(summary.present || 0),
    wfh: Number(summary.wfh || 0),
    late: Number(summary.late || 0),
    absent: Number(summary.absent || 0),
    halfDay: Number(summary.halfDay || 0),
    avgHours: avgFromApi != null
      ? Number(avgFromApi)
      : (totalDays ? Number((totalHours / totalDays).toFixed(1)) : 0),
    overtime: Number(summary.overtimeHours || 0),
    totalHours,
    incomplete: Number(summary.incomplete || 0),
    workingDays: Number(summary.workingDays || 0),
    totalDays,
  };
}

export async function fetchEmployeeAttendanceReportApi(employeeId, params = {}) {
  const data = await apiRequest({ method: 'GET', url: `/attendance/report/${employeeId}`, params });
  const list = Array.isArray(data) ? data : (data?.records || []);
  return {
    records: list.map(mapAttendanceFromApi),
    summary: mapAttendanceSummaryFromApi(Array.isArray(data) ? {} : data),
  };
}

export async function fetchEmployeeDashboardAttendance() {
  const dash = await apiRequest({ method: 'GET', url: '/dashboard/employee' });
  return {
    todayStatus: mapTodayStatusFromApi(dash.todayStatus),
    last7Days: mapLast7DaysFromApi(dash.last7Days || []),
    attendanceThisMonth: dash.kpis?.attendanceThisMonth ?? 0,
  };
}

export async function fetchAdmsStatusApi() {
  return apiRequest({ method: 'GET', url: '/attendance/adms/test' });
}

export async function updateAdmsDeviceApi(serial, { name, location }) {
  return apiRequest({ method: 'PUT', url: `/attendance/adms/devices/${serial}`, data: { name, location } });
}

export async function fetchDevicePunchesTodayApi(employeeId) {
  return apiRequest({
    method: 'GET',
    url: '/attendance/device-punches/today',
    params: employeeId ? { employee_id: employeeId } : {},
  });
}

export async function manualAttendanceEntryApi(payload) {
  const data = await apiRequest({
    method: 'PUT',
    url: '/attendance/manual-entry',
    data: toSnakeCase(payload),
  });
  return mapAttendanceFromApi(data);
}
