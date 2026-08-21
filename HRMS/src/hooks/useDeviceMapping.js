import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import {
  fetchDeviceMappingsApi, createDeviceMappingApi, deleteDeviceMappingApi, fetchUnmappedPunchesApi,
} from '../api/deviceMapping.api';
import { invalidateAndRefetch } from '../lib/queryCache';

export function useDeviceMappings() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const enabled = isAuthenticated && (role === 'admin' || role === 'hr');
  return useQuery({
    queryKey: ['device-mapping', 'list'],
    queryFn: fetchDeviceMappingsApi,
    enabled,
    staleTime: 30_000,
  });
}

export function useUnmappedPunches() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const enabled = isAuthenticated && (role === 'admin' || role === 'hr');
  return useQuery({
    queryKey: ['device-mapping', 'unmapped'],
    queryFn: fetchUnmappedPunchesApi,
    enabled,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useDeviceMappingMutations() {
  const qc = useQueryClient();
  const invalidate = () => invalidateAndRefetch(qc, ['device-mapping']);
  return {
    create: useMutation({ mutationFn: createDeviceMappingApi, onSuccess: invalidate }),
    remove: useMutation({
      mutationFn: ({ deviceUserId, deviceSerial }) => deleteDeviceMappingApi(deviceUserId, deviceSerial),
      onSuccess: invalidate,
    }),
  };
}
