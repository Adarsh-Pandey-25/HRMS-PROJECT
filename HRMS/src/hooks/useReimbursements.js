import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchMyReimbursementsApi, fetchTeamReimbursementsApi, fetchAllReimbursementsApi,
  submitReimbursementApi, approveReimbursementApi, rejectReimbursementApi, deleteReimbursementApi,
} from '../api/reimbursements.api';

import { invalidateAndRefetch } from '../lib/queryCache';

export function useMyReimbursements() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['reimbursements', 'my'], queryFn: fetchMyReimbursementsApi, enabled: isAuthenticated });
}

export function useTeamReimbursements(options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false;
  return useQuery({
    queryKey: ['reimbursements', 'team', options.status || 'all'],
    queryFn: () => fetchTeamReimbursementsApi(options.status ? { status: options.status } : {}),
    enabled: isAuthenticated && enabled,
  });
}

export function useAllReimbursements(options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false;
  return useQuery({
    queryKey: ['reimbursements', 'all', options.status || 'all'],
    queryFn: () => fetchAllReimbursementsApi(options.status ? { status: options.status } : {}),
    enabled: isAuthenticated && enabled,
  });
}

export function useReimbursementMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['reimbursements']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    submit: useMutation({ mutationFn: submitReimbursementApi, onSuccess: invalidate }),
    approve: useMutation({ mutationFn: approveReimbursementApi, onSuccess: invalidate }),
    reject: useMutation({ mutationFn: ({ id, reason }) => rejectReimbursementApi(id, reason), onSuccess: invalidate }),
    withdraw: useMutation({ mutationFn: deleteReimbursementApi, onSuccess: invalidate }),
  };
}
