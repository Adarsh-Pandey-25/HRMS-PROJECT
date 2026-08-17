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
