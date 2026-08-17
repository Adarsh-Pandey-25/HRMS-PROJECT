import { useEffect } from 'react';
import { useCompanyStore } from '../store/companyStore';

/** Keeps the browser tab title in sync with the configured company name. */
export function useSyncDocumentTitle() {
  const companyName = useCompanyStore((s) => s.company.name);

  useEffect(() => {
    document.title = `${companyName} · HRMS`;
  }, [companyName]);
}
