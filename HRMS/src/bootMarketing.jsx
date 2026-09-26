import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import MarketingApp from './marketing/MarketingApp';

/** The public site on the apex. Hydrates the pre-rendered HTML when present (production), renders fresh otherwise (dev). */
export function bootMarketing(rootEl) {
  const initialPlans = Array.isArray(window.__SPAXSYNC_PLANS__) ? window.__SPAXSYNC_PLANS__ : [];
  const tree = (
    <StrictMode>
      <BrowserRouter>
        <MarketingApp initialPlans={initialPlans} />
      </BrowserRouter>
    </StrictMode>
  );
  // The empty template holds only the <!--app-html--> comment, so check for an element.
  if (rootEl.firstElementChild) hydrateRoot(rootEl, tree);
  else createRoot(rootEl).render(tree);
}
