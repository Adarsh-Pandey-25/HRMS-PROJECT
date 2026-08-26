import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchCareerEventsApi, addCareerNoteApi } from '../api/careerEvents.api';

export function useCareerEvents(employeeId) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['careerEvents', employeeId],
    queryFn: () => fetchCareerEventsApi(employeeId),
    enabled: isAuthenticated && Boolean(employeeId),
    staleTime: 30_000,
  });
}

export function useCareerEventMutations(employeeId) {
  const qc = useQueryClient();
  return {
    addNote: useMutation({
      mutationFn: (payload) => addCareerNoteApi(employeeId, payload),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['careerEvents', employeeId] }),
    }),
  };
}
