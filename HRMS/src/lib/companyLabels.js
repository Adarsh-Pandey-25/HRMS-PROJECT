/** User-facing labels for company hierarchy (API still uses parent/child). */

export function companyTypeLabel(type) {
  if (type === 'parent') return 'Main company';
  if (type === 'child') return 'Subsidiary';
  if (type === 'standalone') return 'Standalone';
  return type || 'Company';
}

export function companyTypeBadgeTone(type) {
  if (type === 'parent') return 'primary';
  if (type === 'child') return 'teal';
  return 'neutral';
}

/** Short suffix for selects */
export function companyOptionLabel(company, { markHomeAs = 'Main company' } = {}) {
  if (!company) return '';
  const name = company.name || 'Company';
  if (company.isHome) return `${name} (${markHomeAs})`;
  if (company.companyType === 'child') return `${name} (Subsidiary)`;
  if (company.companyType === 'parent') return `${name} (Main company)`;
  return name;
}

/**
 * Best-effort email domain for this specific company, derived from its own
 * website or contact email — this platform is multi-tenant, so a domain must
 * never be hardcoded to one tenant. Returns '' when the company record has
 * neither field set.
 */
export function companyEmailDomain(company) {
  if (!company) return '';
  const fromWebsite = String(company.website || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
  if (fromWebsite && fromWebsite.includes('.')) return fromWebsite;
  const fromEmail = String(company.contactEmail || '').split('@')[1];
  return fromEmail ? fromEmail.trim().toLowerCase() : '';
}
