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
  // The accessible-companies list keeps website and contact email under `profile`.
  if (company.profile && typeof company.profile === 'object') {
    const own = companyEmailDomain({ website: company.profile.website, contactEmail: company.profile.contactEmail });
    if (own) return own;
  }
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

/**
 * The email domain for the company an employee is being added to — that
 * company's own, never another's: a subsidiary's people must not get the main
 * company's domain (owner's report, 23 Nov 2026). `companyId` is the company
 * chosen in the form; `accessibleCompanies` is the group's list;
 * `brandedCompany` is the signed-in company, used only for itself.
 * '' when that company has no website or contact email yet.
 */
export function emailDomainForCompany(companyId, accessibleCompanies, brandedCompany) {
  const chosen = (accessibleCompanies || []).find((c) => String(c.id) === String(companyId || ''));
  if (!chosen) return companyEmailDomain(brandedCompany);
  const own = companyEmailDomain(chosen);
  if (own) return own;
  return chosen.isHome ? companyEmailDomain(brandedCompany) : '';
}
