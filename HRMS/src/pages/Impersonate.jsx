import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLoader } from '../components/layout/PageLoader';
import { startImpersonationApi } from '../api/auth.api';
import { useAuthStore } from '../store/authStore';

/**
 * Landing page on a company subdomain for a super-admin impersonation
 * handoff. The super-admin panel (on the apex) opens
 * /impersonate#token=…; this page claims the token once, which sets this
 * host's session cookie, then enters the app.
 */
export default function Impersonate() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // Drop the token from the address bar and history right away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError('This impersonation link is missing its token.');
      return;
    }
    startImpersonationApi(token)
      .then(() => useAuthStore.getState().hydrateSession())
      .then((ok) => {
        if (ok) navigate('/dashboard', { replace: true });
        else setError('Could not start the session. Start impersonation again from the super-admin panel.');
      })
      .catch((err) => setError(err.message || 'This impersonation link is invalid or has already been used.'));
  }, [navigate]);

  if (!error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <PageLoader />
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-fg">Impersonation not started</h1>
        <p className="mt-2 text-sm text-fg-muted">{error}</p>
      </div>
    </main>
  );
}
