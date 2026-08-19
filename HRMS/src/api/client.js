import axios from 'axios';
import { unwrapApiData, toCamelCase } from '../lib/case';

const TOKEN_KEY = 'hrms_access_token';
const rawApiBase = String(import.meta.env.VITE_API_URL || '').trim();
const normalizedApiBase = (() => {
  if (!rawApiBase) return '/api';
  const base = rawApiBase.replace(/\/$/, '');
  if (/^https?:\/\//i.test(base) && !/\/api$/i.test(base)) {
    return `${base}/api`;
  }
  return base;
})();

export const api = axios.create({
  baseURL: normalizedApiBase,
  timeout: 30_000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    // Free ngrok returns an HTML interstitial unless this header is set
    'ngrok-skip-browser-warning': 'true',
  },
});

/** Clear any legacy localStorage JWT (cookies are the session source of truth). */
export function setStoredToken(token) {
  if (token) {
    // Never persist JWTs in localStorage — ignore writes.
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredToken() {
  // Intentionally unused for auth — kept only to clear legacy keys.
  return null;
}

let logoutHandler = null;

/** Register the store logout fn once at app init to break circular imports. */
export function registerLogoutHandler(fn) {
  logoutHandler = fn;
}

api.interceptors.request.use((config) => {
  // Cookie session only — do not attach Bearer from localStorage.
  localStorage.removeItem(TOKEN_KEY);
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers && typeof config.headers.delete === 'function') {
      config.headers.delete('Content-Type');
    } else if (config.headers) {
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const reqUrl = String(error.config?.url || '');
    // Super-admin 401s must not clear company employee sessions.
    const isSuperAdminRoute = reqUrl.includes('/super-admin');
    const isSessionProbe = /\/auth\/me(?:\?|$)/.test(reqUrl) || /\/super-admin\/me(?:\?|$)/.test(reqUrl);
    if (status === 401 && logoutHandler && !isSuperAdminRoute && !isSessionProbe) {
      logoutHandler({ silent: true });
    }
    const msg =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      'Network error';
    const details = error.response?.data?.error?.details;
    if (Array.isArray(details) && details.length) {
      const first = details[0];
      const detailMsg = first.message || first.msg || msg;
      const err = new Error(detailMsg === 'Invalid value' && first.field
        ? `Invalid ${first.field}`
        : detailMsg);
      err.status = status;
      err.details = details;
      return Promise.reject(err);
    }
    const err = new Error(msg);
    err.status = status;
    err.details = details || null;
    err.data = error.response?.data?.data ?? null;
    return Promise.reject(err);
  }
);

/** GET/POST helper that unwraps `{ success, data }` and converts keys to camelCase. */
export async function apiRequest(config) {
  const res = await api(config);
  return unwrapApiData(res);
}

/** Paginated list helper — returns `{ items, meta }`. */
export async function apiRequestPaginated(config) {
  const res = await api(config);
  const body = res?.data;
  if (body && typeof body === 'object' && 'success' in body) {
    if (!body.success) {
      const msg = body.error?.message || body.message || 'Request failed';
      throw new Error(msg);
    }
    return {
      items: toCamelCase(Array.isArray(body.data) ? body.data : []),
      meta: toCamelCase(body.meta || null),
    };
  }
  return { items: toCamelCase(body) || [], meta: null };
}

/** Multipart form upload (receipts, documents, logos). */
export async function apiUpload(config) {
  const res = await api({
    ...config,
    headers: {
      ...config.headers,
      'Content-Type': undefined,
    },
  });
  return unwrapApiData(res);
}
