import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { PlansProvider } from './lib/plans';
import { findMarketingRoute, NOT_FOUND_ROUTE } from './routes';
import Home from './pages/Home';
import Features from './pages/Features';
import Pricing from './pages/Pricing';
import About from './pages/About';
import Contact from './pages/Contact';
import StartTrial from './pages/StartTrial';
import NotFound from './pages/NotFound';
import { Privacy, Terms, RefundPolicy, Security } from './pages/legal';

/** Keeps <title>/description in step on client-side navigation (the pre-render writes them for first load). */
function HeadSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const route = findMarketingRoute(pathname) || NOT_FOUND_ROUTE;
    document.title = route.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', route.description);
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/**
 * The public site on the apex domain. Rendered to static HTML at build time
 * (src/entry-marketing-server.jsx + scripts/prerender.mjs) and hydrated in
 * the browser (main.jsx). Must stay SSR-safe: no window/document access
 * outside effects.
 */
export default function MarketingApp({ initialPlans }) {
  return (
    <PlansProvider initialPlans={initialPlans}>
      <HeadSync />
      <div className="flex min-h-screen flex-col bg-white font-sans text-ink antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
        <Header />
        <main id="main" className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/features" element={<Features />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/start-trial" element={<StartTrial />} />
            <Route path="/security" element={<Security />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/refund-policy" element={<RefundPolicy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </PlansProvider>
  );
}
