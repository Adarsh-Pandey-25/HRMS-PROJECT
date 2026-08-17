import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchMyReimbursementsApi, fetchTeamReimbursementsApi, fetchAllReimbursementsApi,
  submitReimbursementApi, approveReimbursementApi, rejectReimbursementApi,
} from '../api/reimbursements.api';

import { invalidateAndRefetch } from '../lib/queryCache';

export function useMyReimbursements() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['reimbursements', 'my'], queryFn: fetchMyReimbursementsApi, enabled: isAuthenticated });
}

export function useTeamReimbursements() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['reimbursements', 'team'], queryFn: fetchTeamReimbursementsApi, enabled: isAuthenticated });
}

export function useAllReimbursements() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({ queryKey: ['reimbursements', 'all'], queryFn: fetchAllReimbursementsApi, enabled: isAuthenticated });
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
  };
}
