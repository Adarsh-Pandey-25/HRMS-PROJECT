import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { startSessionHydration } from './store/authStore';
import { queryClient } from './lib/queryClient';

/** The HRMS app: company workspaces, plus /super-admin and /onboarding on the apex. */
export function bootApp(rootEl) {
  // Restore cookie session before first paint so reload feels instant.
  startSessionHydration();

  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
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
}
