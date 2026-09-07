import { useState } from 'react';
import { Eye, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { apiRequest } from '../../api/client';

/**
 * Persistent, unmissable banner across the REAL app UI (not just the
 * super-admin panel) while a super admin is impersonating this company's
 * admin — per Module 4's spec. Reads user.impersonation, set by
 * auth.middleware.js off the token's own `typ: 'impersonation'` claim.
 */
export function ImpersonationBanner() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [ending, setEnding] = useState(false);
  const impersonation = user?.impersonation;

  if (!impersonation?.isImpersonating) return null;

  const endSession = async () => {
    setEnding(true);
    try {
      // Also clears the session cookies server-side (see auth.controller.js's
      // endImpersonation) — this token is dead the instant this call
      // succeeds, not just cosmetically "ended" in the UI.
      await apiRequest({ method: 'POST', url: '/auth/impersonation/end' });
    } catch {
      /* the session's hard TTL will end it regardless */
    } finally {
      toast.success('Impersonation session ended');
      // silent: cookies are already cleared server-side above (or will
      // naturally reject on next use) — this just resets local JS state
      // before the full-page navigation below discards it anyway.
      await logout({ silent: true });
      window.location.href = '/super-admin/companies';
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-warning text-white px-4 py-2 text-sm font-medium sticky top-0 z-[200]">
      <span className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        Viewing as {impersonation.companyName || 'this company'}'s admin — impersonated by {impersonation.superAdminEmail}
      </span>
      <button
        type="button"
        onClick={endSession}
        disabled={ending}
        className="flex items-center gap-1.5 rounded-md bg-black/10 px-2.5 py-1 hover:bg-black/20 transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" /> End Impersonation
      </button>
    </div>
  );
}
