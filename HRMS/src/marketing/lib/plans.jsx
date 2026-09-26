import { createContext, useContext, useEffect, useState } from 'react';
import { fetchPublicPlans } from './api';

/**
 * Plans come from GET /api/public/plans. The pre-render embeds them in the
 * page (window.__SPAXSYNC_PLANS__) so prices are in the HTML for visitors
 * and search engines; the browser refreshes them once after load.
 */
const PlansContext = createContext({ plans: [], status: 'idle' });

export function PlansProvider({ initialPlans, children }) {
  const [state, setState] = useState(() => ({
    plans: Array.isArray(initialPlans) ? initialPlans : [],
    status: Array.isArray(initialPlans) && initialPlans.length ? 'ready' : 'loading',
  }));

  useEffect(() => {
    let cancelled = false;
    fetchPublicPlans()
      .then((plans) => { if (!cancelled && Array.isArray(plans)) setState({ plans, status: 'ready' }); })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, status: s.plans.length ? 'ready' : 'error' })); });
    return () => { cancelled = true; };
  }, []);

  return <PlansContext.Provider value={state}>{children}</PlansContext.Provider>;
}

export const usePlans = () => useContext(PlansContext);
