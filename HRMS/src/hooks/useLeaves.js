import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchMyLeavesApi, fetchTeamLeavesApi, fetchAllLeavesApi,
  fetchLeaveBalanceApi, fetchLeaveTypesApi, applyLeaveApi, approveLeaveApi, rejectLeaveApi, cancelLeaveApi,
} from '../api/leaves.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useMyLeaves(options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false;
  return useQuery({
    queryKey: ['leaves', 'my'],
    queryFn: fetchMyLeavesApi,
    enabled: isAuthenticated && enabled,
  });
}

export function useTeamLeaves(options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false;
  return useQuery({
    queryKey: ['leaves', 'team', options.status || 'all'],
    queryFn: () => fetchTeamLeavesApi({
      limit: 100,
      ...(options.status ? { status: options.status } : {}),
    }),
    enabled: isAuthenticated && enabled,
  });
}

export function useAllLeaves(options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false;
  return useQuery({
    queryKey: ['leaves', 'all', options.status || 'all'],
    queryFn: () => fetchAllLeavesApi({
      limit: 100,
      ...(options.status ? { status: options.status } : {}),
    }),
    enabled: isAuthenticated && enabled,
  });
}

export function useLeaveBalance(employeeId) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const year = new Date().getFullYear();
  return useQuery({
    queryKey: ['leaves', 'balance', employeeId, year],
    queryFn: () => fetchLeaveBalanceApi(employeeId, year),
    enabled: isAuthenticated && Boolean(employeeId),
  });
}

export function useLeaveTypes(year) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const y = year || new Date().getFullYear();
  return useQuery({
    queryKey: ['leaves', 'types', y],
    queryFn: () => fetchLeaveTypesApi(y),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

export function useLeaveMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['leaves']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    apply: useMutation({ mutationFn: applyLeaveApi, onSuccess: invalidate }),
    approve: useMutation({ mutationFn: approveLeaveApi, onSuccess: invalidate }),
    reject: useMutation({ mutationFn: ({ id, reason }) => rejectLeaveApi(id, reason), onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: cancelLeaveApi, onSuccess: invalidate }),
  };
}
