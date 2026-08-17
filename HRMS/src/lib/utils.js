import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  format,
  formatDistanceToNow,
  parseISO,
  differenceInDays,
  isValid,
} from 'date-fns';

/** Merge conditional class names + resolve Tailwind conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Initials from a name, e.g. "Esther Howard" -> "EH". */
export function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
}

function safeDate(value) {
  if (!value) return null;
  const d = typeof value === 'string' ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

/** Format a date. Pattern defaults to "12 Jul 2026". */
export function formatDate(value, pattern = 'dd MMM yyyy') {
  const d = safeDate(value);
  return d ? format(d, pattern) : '—';
}

export function formatDateTime(value) {
  const d = safeDate(value);
  return d ? format(d, 'dd MMM yyyy, h:mm a') : '—';
}

export function timeAgo(value) {
  const d = safeDate(value);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : '—';
}

export function daysBetween(from, to) {
  const a = safeDate(from);
  const b = safeDate(to);
  if (!a || !b) return 0;
  return Math.abs(differenceInDays(b, a)) + 1;
}

/** Indian rupee formatting: 101300 -> "₹1,01,300". */
export function formatCurrency(amount, currency = 'INR') {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Compact numbers: 1200000 -> "12L", 34000 -> "34K" for Indian format. */
export function formatCompactINR(amount) {
  if (amount == null || isNaN(amount)) return '—';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(0)}K`;
  return `₹${amount}`;
}

export function formatNumber(n) {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IN').format(n);
}

/** Title-case a slug/enum, e.g. "on-leave" -> "On Leave". */
export function humanize(str) {
  if (str == null || str === '') return '';
  const text = String(str);
  return text
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Strip HTML tags for plain-text previews, e.g. rich-text announcement bodies. */
export function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Sanitize rich HTML before dangerouslySetInnerHTML.
 * Removes scripts/iframes and event-handler / javascript: attributes.
 */
export function sanitizeHtml(html = '') {
  if (!html || typeof document === 'undefined') return stripHtml(html);
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,link,meta,style,form').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '');
      if (
        name.startsWith('on')
        || name === 'srcdoc'
        || name === 'xlink:href'
        || ((name === 'href' || name === 'src') && /^\s*(javascript|data|vbscript):/i.test(value))
      ) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

/** Allow only http(s) / relative / mailto / tel links for attachments. */
export function safeHref(url = '') {
  const s = String(url || '').trim();
  if (!s) return '#';
  if (/^(https?:|mailto:|tel:|\/)/i.test(s)) return s;
  return '#';
}

/** Simple debounce for search inputs. */
export function debounce(fn, delay = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

/** Clamp helper. */
export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** Pick a stable pseudo-random item from an array by seed string. */
export function seededPick(arr, seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return arr[Math.abs(hash) % arr.length];
}
