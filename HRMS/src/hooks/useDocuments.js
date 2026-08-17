import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchMyDocumentsApi, fetchAllDocumentsApi, fetchEmployeeDocumentsApi,
  uploadDocumentApi, verifyDocumentApi, deleteDocumentApi,
} from '../api/documents.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useMyDocuments(params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['documents', 'my', params],
    queryFn: () => fetchMyDocumentsApi(params),
    enabled: isAuthenticated,
  });
}

export function useAllDocuments(params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['documents', 'all', params],
    queryFn: () => fetchAllDocumentsApi(params),
    enabled: isAuthenticated,
  });
}

export function useEmployeeDocuments(employeeId, params) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['documents', 'employee', employeeId, params],
    queryFn: () => fetchEmployeeDocumentsApi(employeeId, params),
    enabled: isAuthenticated && Boolean(employeeId),
  });
}

export function useDocumentMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['documents']);
    await invalidateAndRefetch(qc, ['employees']);
  };
  return {
    upload: useMutation({ mutationFn: uploadDocumentApi, onSuccess: invalidate }),
    verify: useMutation({ mutationFn: verifyDocumentApi, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: deleteDocumentApi, onSuccess: invalidate }),
  };
}
