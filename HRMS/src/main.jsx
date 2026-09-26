import './index.css';
import { isApexHost } from './lib/host';
import { isMarketingPath } from './marketing/routes';

// The PWA was retired. Remove any service worker and cache an older build
// left behind (public/sw.js does the same from inside the worker).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {});
}
if (typeof caches !== 'undefined') {
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
}

const rootEl = document.getElementById('root');

// Two bundles: the marketing site (apex, public pages) and the HRMS app.
// Dynamic imports keep the app's code off the marketing pages.
if (isApexHost() && isMarketingPath(window.location.pathname)) {
  import('./bootMarketing').then(({ bootMarketing }) => bootMarketing(rootEl));
} else {
  import('./bootApp').then(({ bootApp }) => bootApp(rootEl));
}
