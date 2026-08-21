import { useEffect } from 'react';
import { useCompanyStore } from '../store/companyStore';

const DEFAULT_FAVICON = '/favicon.svg';

function setFaviconHref(href) {
  if (typeof document === 'undefined') return;
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = href.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  link.href = href;
}

/** Keep the browser tab favicon in sync with the company brand icon. */
export function useBrandFavicon() {
  const brandIconUrl = useCompanyStore((s) => s.company.brandIconUrl);

  useEffect(() => {
    setFaviconHref(brandIconUrl || DEFAULT_FAVICON);
  }, [brandIconUrl]);
}
