import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { globalSearchApi } from '../api/dashboard.api';
import { employeeProfilePath } from '../lib/employeeRoutes';

export const SEARCH_CATEGORY_LABELS = {
  employees: 'Employees',
  announcements: 'Announcements',
  leaves: 'Leave Requests',
};

function mapResults(data) {
  if (!data) return {};
  const results = {};
  if (data.employees?.length) {
    results.employees = data.employees.map((e) => ({
      id: e.id,
      title: e.label,
      subtitle: e.sublabel || '',
      path: employeeProfilePath({ employeeCode: e.employeeCode, id: e.id }),
    }));
  }
  if (data.announcements?.length) {
    results.announcements = data.announcements.map((a) => ({
      id: a.id,
      title: a.label,
      subtitle: 'Announcement',
      path: '/announcements',
    }));
  }
  if (data.leaves?.length) {
    results.leaves = data.leaves.map((l) => ({
      id: l.id,
      title: l.label,
      subtitle: l.sublabel || '',
      path: '/leave/approvals',
    }));
  }
  return results;
}

/** Server-backed global search (debounced query from the caller). */
export function useGlobalSearchQuery(query) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const q = String(query || '').trim();
  return useQuery({
    queryKey: ['search', q],
    queryFn: () => globalSearchApi(q),
    enabled: isAuthenticated && q.length >= 2,
    select: mapResults,
    staleTime: 30_000,
  });
}
