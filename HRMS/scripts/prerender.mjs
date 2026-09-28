/**
 * Pre-renders the marketing site after `vite build`:
 *   dist/_marketing/index.html, dist/_marketing/<route>/index.html, dist/_marketing/404.html
 *   dist/_marketing/sitemap.xml, dist/_marketing/robots.txt
 * nginx serves these on the apex; the browser bundle then hydrates them.
 *
 * Plans are fetched from PRERENDER_API_URL (e.g. http://127.0.0.1:5050) so
 * prices are in the HTML. If the API is unreachable the build fails, unless
 * ALLOW_PRERENDER_WITHOUT_API=1 — then pages ship without prices and the
 * browser loads them after hydration.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ssrEntry = path.join(root, 'dist-ssr', 'entry-marketing-server.js');

const {
  render, MARKETING_ROUTES, NOT_FOUND_ROUTE, SITE, HOME_FAQ, PRICING_FAQ,
} = await import(pathToFileURL(ssrEntry).href);

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON inside <script>: stop "</script>" and friends from closing the tag early.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

async function loadPlans() {
  const apiUrl = (process.env.PRERENDER_API_URL || '').replace(/\/$/, '');
  const allowWithout = process.env.ALLOW_PRERENDER_WITHOUT_API === '1';
  if (!apiUrl) {
    if (allowWithout) { console.warn('[prerender] PRERENDER_API_URL not set — pages will load prices in the browser.'); return []; }
    throw new Error(
      'PRERENDER_API_URL is required for the build — the marketing pages bake in live plan pricing.\n'
      + '  Point it at the running backend, e.g.:\n'
      + '    PRERENDER_API_URL=http://127.0.0.1:5050 npm run build\n'
      + '  Or build without pre-rendered prices (they load in the browser instead):\n'
      + '    ALLOW_PRERENDER_WITHOUT_API=1 npm run build',
    );
  }
  try {
    const res = await fetch(`${apiUrl}/api/public/plans`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const plans = Array.isArray(body?.data) ? body.data : [];
    console.log(`[prerender] ${plans.length} plans from ${apiUrl}`);
    return plans;
  } catch (err) {
    if (allowWithout) { console.warn(`[prerender] Could not fetch plans (${err.message}) — continuing without.`); return []; }
    throw new Error(`[prerender] Could not fetch plans from ${apiUrl}: ${err.message}`);
  }
}

const faqLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

function structuredData(route, plans) {
  const org = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    logo: `${SITE.url}/spaxsync-icon-512.png`,
    email: SITE.supportEmail,
  };
  const blocks = [org];
  if (route.path === '/' || route.path === '/pricing') {
    const priced = plans.filter((p) => Number(p.priceMonthly) > 0);
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE.name,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: SITE.description,
      url: SITE.url,
      ...(priced.length ? {
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'INR',
          lowPrice: Math.min(...priced.map((p) => Number(p.priceMonthly))),
          highPrice: Math.max(...priced.map((p) => Number(p.priceMonthly))),
          offerCount: priced.length,
        },
      } : {}),
    });
    if (route.path === '/') blocks.push(faqLd(HOME_FAQ));
  }
  if (route.path !== '/' && !route.noindex) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE.name, item: `${SITE.url}/` },
        { '@type': 'ListItem', position: 2, name: route.title.split(' — ')[0], item: `${SITE.url}${route.path}` },
      ],
    });
  }
  if (route.path === '/pricing') blocks.push(faqLd(PRICING_FAQ));
  return blocks;
}

function headFor(route, plans) {
  const url = `${SITE.url}${route.path === '/' ? '/' : route.path}`;
  const tags = [
    `<title>${escapeHtml(route.title)}</title>`,
    `<meta name="description" content="${escapeHtml(route.description)}" />`,
    route.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE.name)}" />`,
    `<meta property="og:title" content="${escapeHtml(route.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(route.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE.url}/og-image.png" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...structuredData(route, plans).map((b) => `<script type="application/ld+json">${safeJson(b)}</script>`),
    `<script>window.__SPAXSYNC_PLANS__=${safeJson(plans)}</script>`,
  ];
  return tags.join('\n    ');
}

function fillTemplate(template, head, appHtml) {
  if (!template.includes('<!--head-->') || !template.includes('<!--app-html-->')) {
    throw new Error('dist/index.html is missing the <!--head--> or <!--app-html--> placeholder');
  }
  return template
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace('<!--head-->', head)
    .replace('<!--app-html-->', appHtml);
}

const template = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const plans = await loadPlans();
const outDir = path.join(dist, '_marketing');
await fs.rm(outDir, { recursive: true, force: true });

for (const route of MARKETING_ROUTES) {
  const html = fillTemplate(template, headFor(route, plans), render(route.path, { plans }));
  const file = route.path === '/' ? path.join(outDir, 'index.html') : path.join(outDir, route.path.slice(1), 'index.html');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html);
}
await fs.writeFile(path.join(outDir, '404.html'), fillTemplate(template, headFor(NOT_FOUND_ROUTE, plans), render('/404-not-found', { plans })));

const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${MARKETING_ROUTES.map((r) => `  <url><loc>${SITE.url}${r.path === '/' ? '/' : r.path}</loc><lastmod>${today}</lastmod><priority>${r.priority}</priority></url>`).join('\n')}
</urlset>
`;
await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap);
await fs.writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nDisallow: /super-admin\nDisallow: /onboarding\nDisallow: /api\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`);

console.log(`[prerender] Wrote ${MARKETING_ROUTES.length} pages + 404, sitemap.xml, robots.txt`);
