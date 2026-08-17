import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.jsx';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { PwaInstallPrompt } from './components/layout/PwaInstallPrompt';
import { startSessionHydration } from './store/authStore';
import { queryClient } from './lib/queryClient';

// Restore cookie session before first paint so reload feels instant.
startSessionHydration();

if (import.meta.env.DEV) {
  // A SW left behind by `npm run preview` on this same port would serve a stale
  // bundle and hide new routes. Drop it so dev always runs current source.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
  }
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
  }
} else {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <PwaInstallPrompt />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: '12px',
              background: 'rgb(var(--color-card))',
              color: 'rgb(var(--color-text-primary))',
              border: '1px solid rgb(var(--color-border))',
              fontSize: '14px',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
