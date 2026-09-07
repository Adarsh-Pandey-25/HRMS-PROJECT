import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getExportStatusApi } from '../api/subscription.api';

export const EXPORT_BLOCKED_MESSAGE =
  "Data export is unavailable while your subscription is not in good standing. Contact your account administrator or billing to resolve this.";

/**
 * Item 6: real server-checked export authorization — not a cached client
 * flag. Short staleTime (subscription status/override can change and this
 * gates a real action) but still cached briefly so opening the export
 * dropdown doesn't fire a request on every render.
 */
export function useExportAuthorization() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data, isLoading } = useQuery({
    queryKey: ['company', 'me', 'export-status'],
    queryFn: getExportStatusApi,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  // Fail open while loading/unknown — the same convention used everywhere
  // else in this session (assertSeatAvailable, hasFeature) — a transient
  // loading state must never look identical to "blocked."
  const allowed = isLoading || data == null ? true : Boolean(data.allowed);
  return { allowed, loading: isLoading, reason: data?.reason };
}

/** For a fresh, un-cached check right before actually performing an export (defense in depth). */
export function useFreshExportCheck() {
  const qc = useQueryClient();
  return async () => {
    const data = await qc.fetchQuery({ queryKey: ['company', 'me', 'export-status'], queryFn: getExportStatusApi, staleTime: 0 });
    return Boolean(data?.allowed);
  };
}
