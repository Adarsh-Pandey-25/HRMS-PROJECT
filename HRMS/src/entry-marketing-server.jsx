import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import MarketingApp from './marketing/MarketingApp';
import { MARKETING_ROUTES, NOT_FOUND_ROUTE } from './marketing/routes';
import { SITE } from './marketing/siteConfig';
import { HOME_FAQ, PRICING_FAQ } from './marketing/data/faq';

/** Server entry for scripts/prerender.mjs — never shipped to the browser. */
export function render(url, { plans = [] } = {}) {
  return renderToString(
    <StaticRouter location={url}>
      <MarketingApp initialPlans={plans} />
    </StaticRouter>,
  );
}

export { MARKETING_ROUTES, NOT_FOUND_ROUTE, SITE, HOME_FAQ, PRICING_FAQ };
