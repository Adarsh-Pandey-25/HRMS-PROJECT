import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:5000',
    changeOrigin: true,
    secure: false,
    // Do NOT use xfwd:true — it appends 127.0.0.1 (Vite→API) and that was
    // winning over the real phone IP from ngrok.
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        const chain = [];
        const add = (raw) => {
          if (!raw) return;
          String(raw).split(',').forEach((part) => {
            const t = part.trim();
            if (t && !chain.includes(t)) chain.push(t);
          });
        };
        add(req.headers['x-forwarded-for']);
        add(req.headers['x-real-ip']);
        add(req.headers['cf-connecting-ip']);
        add(req.headers['true-client-ip']);
        // Socket peer is usually 127.0.0.1 from ngrok→Vite; only keep if no better IP.
        const remote = req.socket?.remoteAddress;
        if (remote && !chain.length) add(remote);

        if (chain.length) {
          proxyReq.setHeader('x-forwarded-for', chain.join(', '));
          proxyReq.setHeader('x-real-ip', chain[0]);
        }
      });
    },
  },
  '/health': {
    target: 'http://127.0.0.1:5000',
    changeOrigin: true,
    secure: false,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')
            || id.includes('node_modules/react-router-dom')) return 'vendor-react'
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query'
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/react-hot-toast')) {
            return 'vendor-ui'
          }
          return undefined
        },
      },
    },
  },
  server: {
    // Listen on all interfaces so phones on the same Wi‑Fi can use http://<LAN-IP>:5173
    host: true,
    port: 5173,
    strictPort: true,
    // Exact tunnel hostname prevents arbitrary Host-header forwarding.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', 'hazy-quickness-sixfold.ngrok-free.dev', 'yahoo-revision-silk.ngrok-free.dev'],
    // Do not set Content-Security-Policy here — it breaks Vite React Refresh
    // ("can't detect preamble") and blanks the app. Apply CSP on the production host.
    headers: {
      'Referrer-Policy': 'no-referrer',
      // geolocation=(self): GPS geofence check-in and the "Use current
      // location" geofence-setup button both need it; camera=(self): selfie
      // check-in. Microphone stays locked down.
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
    proxy: apiProxy,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', 'yahoo-revision-silk.ngrok-free.dev'],
    headers: {
      'Referrer-Policy': 'no-referrer',
      // geolocation=(self): GPS geofence check-in and the "Use current
      // location" geofence-setup button both need it; camera=(self): selfie
      // check-in. Microphone stays locked down.
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
    proxy: apiProxy,
  },
})
