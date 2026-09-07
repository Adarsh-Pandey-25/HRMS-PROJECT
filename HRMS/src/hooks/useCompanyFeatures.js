import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getMyCompanyFeaturesApi } from '../api/subscription.api';

/**
 * The current company's effective feature set (plan default merged with any
 * super-admin override — item 5/6 of the super-admin console). Used to hide
 * nav items and gated sub-sections (Settings → Attendance Config, API
 * access, etc.) for modules the company's plan doesn't include.
 *
 * Bug fix (round 1): this previously used a 5-minute staleTime with no
 * refetchOnMount override. Sidebar/MobileNav mount once per session and
 * never remount, so a super-admin toggling a feature on/off was invisible
 * to an already-open tenant session for up to 5 minutes — and even a
 * fresh client-side navigation into a gated settings section (which DOES
 * remount) wouldn't refetch either, since React Query only refetches on
 * mount when the data is actually stale. A short staleTime +
 * refetchOnMount: 'always' fixed the "navigate to a gated section" case.
 *
 * Bug fix (round 2): the round-1 fix still didn't cover a session that's
 * already sitting on a gated section with nothing to remount it — the
 * queryClient's global default is refetchOnWindowFocus: false (set in
 * lib/queryClient.js, deliberately, to avoid refetch storms on data
 * tables), so tab-refocus never re-checked this query either. Net effect:
 * an admin sitting still on Settings > Attendance Config while a
 * super-admin flipped their entitlement would see no change at all until
 * they navigated away and back. Fixed by overriding refetchOnWindowFocus
 * back to true for this one lightweight query, plus a short polling
 * interval so it also self-corrects for a session that never loses focus.
 */
export function useCompanyFeatures() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data } = useQuery({
    queryKey: ['company', 'me', 'features'],
    queryFn: getMyCompanyFeaturesApi,
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  return data;
}
