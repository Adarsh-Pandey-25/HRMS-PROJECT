import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchDashboardApi } from '../api/dashboard.api';

export function useDashboardData() {
  const role = useAuthStore((s) => s.role);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: ['dashboard', role],
    queryFn: () => fetchDashboardApi(role),
    enabled: isAuthenticated && Boolean(role),
    staleTime: 0,
  });
}
