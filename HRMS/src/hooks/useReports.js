import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchTeamPerformanceApi,
  fetchAttendanceSummaryApi,
  fetchPayrollSummaryApi,
  fetchLeaveSummaryApi,
} from '../api/reports.api';

/** Manager-and-above reports — gate the query itself so an Employee session never fires these requests. */
function useCanViewReports() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  return isAuthenticated && ['admin', 'hr', 'manager'].includes(role);
}

export function useTeamPerformanceReport({ month, year, department }, options = {}) {
  const canView = useCanViewReports();
  return useQuery({
    queryKey: ['reports', 'team-performance', month, year, department || null],
    queryFn: () => fetchTeamPerformanceApi({ month, year, department }),
    enabled: canView && Boolean(month) && Boolean(year) && options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

export function useAttendanceSummaryReport({ from, to, department }, options = {}) {
  const canView = useCanViewReports();
  return useQuery({
    queryKey: ['reports', 'attendance-summary', from, to, department || null],
    queryFn: () => fetchAttendanceSummaryApi({ from, to, department }),
    enabled: canView && Boolean(from) && Boolean(to) && options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

export function usePayrollSummaryReport({ month, year, department, groupBy }, options = {}) {
  const canView = useCanViewReports();
  return useQuery({
    queryKey: ['reports', 'payroll-summary', month, year, department || null, groupBy || 'employee'],
    queryFn: () => fetchPayrollSummaryApi({ month, year, department, groupBy }),
    enabled: canView && Boolean(month) && Boolean(year) && options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

export function useLeaveSummaryReport({ year, department, groupBy }, options = {}) {
  const canView = useCanViewReports();
  return useQuery({
    queryKey: ['reports', 'leave-summary', year, department || null, groupBy || 'employee'],
    queryFn: () => fetchLeaveSummaryApi({ year, department, groupBy }),
    enabled: canView && Boolean(year) && options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}
