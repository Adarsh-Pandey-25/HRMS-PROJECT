import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchActiveAnnouncementsApi, fetchAllAnnouncementsApi,
  createAnnouncementApi, updateAnnouncementApi, deleteAnnouncementApi, acknowledgeAnnouncementApi,
} from '../api/announcements.api';
import { fetchUpcomingHolidaysApi } from '../api/holidays.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useActiveAnnouncements() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: fetchActiveAnnouncementsApi,
    enabled: isAuthenticated,
    staleTime: 120_000,
  });
}

export function useAllAnnouncements(params = {}, options = {}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = options.enabled !== false && isAuthenticated;
  return useQuery({
    queryKey: ['announcements', 'all', params],
    queryFn: () => fetchAllAnnouncementsApi(params),
    enabled,
  });
}

export function useAnnouncementMutations() {
  const qc = useQueryClient();
  const invalidate = async () => {
    await invalidateAndRefetch(qc, ['announcements']);
    await invalidateAndRefetch(qc, ['dashboard']);
  };
  return {
    create: useMutation({ mutationFn: createAnnouncementApi, onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, data }) => updateAnnouncementApi(id, data), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: deleteAnnouncementApi, onSuccess: invalidate }),
    acknowledge: useMutation({ mutationFn: acknowledgeAnnouncementApi, onSuccess: invalidate }),
  };
}

export function useUpcomingHolidays() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ['holidays', 'upcoming'],
    queryFn: fetchUpcomingHolidaysApi,
    enabled: isAuthenticated,
    staleTime: 300_000,
  });
}
