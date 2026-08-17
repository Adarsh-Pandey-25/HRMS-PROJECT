import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

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
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register via virtual:pwa-register in main.jsx — avoid double inject.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        id: '/',
        name: 'SPAXADS HRMS',
        short_name: 'HRMS',
        description: 'HR Suite — attendance, leave, payroll, and more',
        theme_color: '#6C63FF',
        background_color: '#F0EFFF',
        display: 'standalone',
        display_override: ['standalone', 'browser'],
        start_url: '/?source=pwa',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api') || url.pathname === '/health',
            handler: 'NetworkOnly',
          },
        ],
      },
      // Dev SW is flaky for real phone installs — use `npm run build && npm run preview`.
      devOptions: {
        enabled: false,
      },
    }),
  ],
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
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
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
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
    proxy: apiProxy,
  },
})
