import { useEffect } from 'react';
import { useCompanyStore } from '../store/companyStore';
import { isTenantHost } from '../lib/host';

/** Tab title for the HRMS app: "SpaxSync · {Company}" on a company subdomain. */
export function useSyncDocumentTitle() {
  const companyName = useCompanyStore((s) => s.company.name);

  useEffect(() => {
    const name = isTenantHost() ? String(companyName || '').trim() : '';
    document.title = name ? `SpaxSync · ${name}` : 'SpaxSync';
  }, [companyName]);
}
