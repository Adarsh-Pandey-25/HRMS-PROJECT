import { apiRequest, apiRequestPaginated } from './client';
import { mapLeaveFromApi, mapLeaveBalanceFromApi, LEAVE_TYPE_TO_API } from '../lib/mappers';

export async function fetchMyLeavesApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/leaves/my-leaves', params });
  return items.map(mapLeaveFromApi);
}

export async function fetchTeamLeavesApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/leaves/team-leaves', params });
  return items.map(mapLeaveFromApi);
}

export async function fetchAllLeavesApi(params = {}) {
  const { items } = await apiRequestPaginated({ method: 'GET', url: '/leaves/all-leaves', params });
  return items.map(mapLeaveFromApi);
}

export async function fetchLeaveBalanceApi(employeeId, year) {
  const rows = await apiRequest({ method: 'GET', url: `/leaves/balance/${employeeId}`, params: { year } });
  return mapLeaveBalanceFromApi(Array.isArray(rows) ? rows : []);
}

/** HR/Admin: set one employee's allocation per leave code (null = back to company policy). */
export async function updateLeaveBalanceApi(employeeId, { year, allocations }) {
  const data = await apiRequest({ method: 'PUT', url: `/leaves/balance/${employeeId}`, data: { year, allocations } });
  return {
    changes: data?.changes || [],
    notified: Boolean(data?.notified),
    emailedAdmins: data?.emailedAdmins || 0,
    balance: mapLeaveBalanceFromApi(Array.isArray(data?.balances) ? data.balances : []),
  };
}

export async function fetchLeaveTypesApi(year) {
  return apiRequest({ method: 'GET', url: '/leaves/types', params: { year } });
}

export async function applyLeaveApi(payload) {
  const raw = payload.leaveType || payload.type || '';
  const leaveType = LEAVE_TYPE_TO_API[raw] || String(raw).toUpperCase();
  const data = await apiRequest({
    method: 'POST',
    url: '/leaves/apply',
    data: {
      leave_type: leaveType,
      from_date: payload.from || payload.fromDate,
      to_date: payload.to || payload.toDate,
      reason: payload.reason,
      is_half_day: payload.isHalfDay || false,
    },
  });
  return mapLeaveFromApi(data);
}

export async function approveLeaveApi(id) {
  const data = await apiRequest({ method: 'PUT', url: `/leaves/${id}/approve` });
  return mapLeaveFromApi(data);
}

export async function rejectLeaveApi(id, rejectionReason = '') {
  const data = await apiRequest({
    method: 'PUT',
    url: `/leaves/${id}/reject`,
    data: { rejection_reason: rejectionReason },
  });
  return mapLeaveFromApi(data);
}

export async function cancelLeaveApi(id) {
  const data = await apiRequest({ method: 'DELETE', url: `/leaves/${id}/cancel` });
  return mapLeaveFromApi(data);
}

export async function fetchLeaveCalendarApi(month, year) {
  return apiRequest({ method: 'GET', url: '/leaves/calendar', params: { month, year } });
}
