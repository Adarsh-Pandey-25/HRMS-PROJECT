import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  checkInApi, checkOutApi, fetchCheckContextApi,
  fetchMyAttendanceApi, fetchTeamAttendanceApi, fetchAllAttendanceApi,
  fetchMonthlySummaryApi, fetchEmployeeAttendanceReportApi,
  requestWfhDayApi, cancelWfhDayApi, fetchPendingWfhRequestsApi, reviewWfhRequestApi,
  manualAttendanceEntryApi, fetchDevicePunchesTodayApi, fetchAdmsStatusApi, updateAdmsDeviceApi,
} from '../api/attendance.api';
import { fetchTeamEmployeesApi } from '../api/employees.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useCheckContext() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['attendance', 'context'],
    queryFn: fetchCheckContextApi,
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}

export function useMyAttendance(params = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['attendance', 'my', params],
    queryFn: () => fetchMyAttendanceApi(params),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

/** Manager: team-attendance · Admin/HR: all-attendance (company-wide) */
export function useTeamAttendance(params = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const isCompanyWide = role === 'admin' || role === 'hr';

  return useQuery({
    queryKey: ['attendance', 'team', role, params],
    queryFn: () => (isCompanyWide ? fetchAllAttendanceApi(params) : fetchTeamAttendanceApi(params)),
    enabled: isAuthenticated,
  });
}

export function useTeamMembers() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery({
    queryKey: ['employees', 'team', userId],
    queryFn: () => fetchTeamEmployeesApi(userId),
    enabled: isAuthenticated && Boolean(userId) && role === 'manager',
    staleTime: 120_000,
  });
}

export function useMonthlyAttendanceSummary(params = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const now = new Date();
  const month = params.month || now.getMonth() + 1;
  const year = params.year || now.getFullYear();
  return useQuery({
    queryKey: ['attendance', 'monthly-summary', month, year],
    queryFn: () => fetchMonthlySummaryApi({ month, year }),
    enabled: isAuthenticated,
  });
}

export function useEmployeeAttendanceReport(employeeId, params = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['attendance', 'report', employeeId, params],
    queryFn: () => fetchEmployeeAttendanceReportApi(employeeId, params),
    enabled: isAuthenticated && Boolean(employeeId),
  });
}

/**
 * Raw biometric punches for today, live-ish via polling (no direct Supabase
 * connection from the browser — see the ADMS integration notes).
 * Pass an employeeId to view another employee's punches (HR/manager only,
 * enforced server-side); omit it to view your own.
 */
export function useDevicePunchesToday(employeeId) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['attendance', 'device-punches', 'today', employeeId || 'self'],
    queryFn: () => fetchDevicePunchesTodayApi(employeeId),
    enabled: isAuthenticated,
    refetchInterval: 7_000,
    staleTime: 5_000,
  });
}

/** HR/Admin-only ADMS pipeline health: known devices, last heartbeat, recent punches, today's count. */
export function useAdmsStatus() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  return useQuery({
    queryKey: ['attendance', 'adms', 'status'],
    queryFn: fetchAdmsStatusApi,
    enabled: isAuthenticated && (role === 'admin' || role === 'hr'),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

export function useUpdateAdmsDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serial, name, location }) => updateAdmsDeviceApi(serial, { name, location }),
    onSuccess: () => invalidateAndRefetch(qc, ['attendance', 'adms']),
  });
}

export function usePendingWfhRequests() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const canReview = role === 'admin' || role === 'hr' || role === 'manager';
  return useQuery({
    queryKey: ['attendance', 'wfh-pending'],
    queryFn: () => fetchPendingWfhRequestsApi(),
    enabled: isAuthenticated && canReview,
    staleTime: 15_000,
  });
}

export function useAttendanceMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['attendance']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  const invalidateAll = async () => {
    await invalidate();
    await invalidateAndRefetch(qc, ['helpdesk']);
  };
  return {
    checkIn: useMutation({ mutationFn: checkInApi, onSuccess: invalidate }),
    checkOut: useMutation({ mutationFn: checkOutApi, onSuccess: invalidate }),
    requestWfh: useMutation({ mutationFn: requestWfhDayApi, onSuccess: invalidate }),
    cancelWfh: useMutation({ mutationFn: cancelWfhDayApi, onSuccess: invalidate }),
    reviewWfh: useMutation({
      mutationFn: ({ id, ...body }) => reviewWfhRequestApi(id, body),
      onSuccess: invalidate,
    }),
    manualEntry: useMutation({ mutationFn: manualAttendanceEntryApi, onSuccess: invalidateAll }),
  };
}
