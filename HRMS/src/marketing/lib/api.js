/**
 * Tiny fetch wrapper for the public marketing endpoints (/api/public/*).
 * Kept separate from src/api/client.js so the marketing bundle doesn't pull
 * in axios and the app's auth/session handling.
 */
const rawBase = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const API_BASE = !rawBase ? '/api' : (/^https?:\/\//i.test(rawBase) && !/\/api$/i.test(rawBase) ? `${rawBase}/api` : rawBase);

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      // Required by the backend CSRF check on state-changing requests.
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fieldError = Array.isArray(body?.error?.details) && body.error.details[0]?.message;
    const err = new Error(fieldError || body?.error?.message || body?.message || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return body?.data;
}

export const fetchPublicPlans = () => request('/public/plans');

export const submitLead = (payload) => request('/public/leads', { method: 'POST', body: JSON.stringify(payload) });
