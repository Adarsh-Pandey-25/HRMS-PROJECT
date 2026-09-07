const { randomUUID } = require('crypto');

/**
 * Legacy / demo data lives under this company until assigned otherwise.
 *
 * ⚠️ getCompanyId() below falls back to this id for ANY employee/address that
 * has no resolvable company_id — including `null`/`undefined` input. That
 * means a bug elsewhere (a failed fetch, a stale/partial object passed in by
 * mistake) doesn't surface as "no company" — it silently resolves to a real,
 * queryable tenant. Every one of this function's ~75 call sites across the
 * codebase inherits that behavior. Not currently reachable through any
 * normal request flow (real employee rows always carry company_id since the
 * subdomain-per-tenant migration), but it's the reason a "just add
 * companyId ?? DEFAULT_COMPANY_ID" fallback should never be added elsewhere
 * to paper over a missing tenant id — prefer failing loud (see
 * recruitment.service.js's resolveCompanyId for the pattern this codebase
 * uses instead) so a real bug surfaces immediately instead of quietly
 * writing/reading legacy-tenant data.
 */
const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

const getAddress = (employeeOrAddress) => {
  if (!employeeOrAddress) return {};
  if (employeeOrAddress.address && typeof employeeOrAddress.address === 'object') {
    return employeeOrAddress.address;
  }
  if (typeof employeeOrAddress === 'object' && !employeeOrAddress.id) {
    return employeeOrAddress;
  }
  return {};
};

/**
 * Resolve company id from employee row (or address object).
 * Prefers real column employees.company_id, then address JSON, else default.
 */
const getCompanyId = (employee) => {
  if (!employee) return DEFAULT_COMPANY_ID;
  if (employee.company_id) return String(employee.company_id);
  const addr = getAddress(employee);
  const raw = addr.company_id || addr.companyId || null;
  return raw ? String(raw) : DEFAULT_COMPANY_ID;
};

const withCompanyId = (address, companyId) => {
  const addr = (address && typeof address === 'object' && !Array.isArray(address))
    ? { ...address }
    : {};
  addr.company_id = companyId;
  return addr;
};

/** Fields to dual-write on employee insert/update (column + JSON). */
const companyIdFields = (companyId, address = {}) => ({
  company_id: companyId || DEFAULT_COMPANY_ID,
  address: withCompanyId(address, companyId || DEFAULT_COMPANY_ID),
});

const newCompanyId = () => randomUUID();

/** Persist settings as t:{companyId}:{key} so tenants do not share config. */
const settingsKey = (companyId, key) => `t:${companyId}:${key}`;

const parseSettingsKey = (fullKey) => {
  const m = /^t:([^:]+):(.+)$/.exec(String(fullKey || ''));
  if (m) return { companyId: m[1], key: m[2] };
  return { companyId: null, key: String(fullKey || '') };
};

module.exports = {
  DEFAULT_COMPANY_ID,
  getCompanyId,
  withCompanyId,
  companyIdFields,
  newCompanyId,
  settingsKey,
  parseSettingsKey,
  getAddress,
};
