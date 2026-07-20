const { randomUUID } = require('crypto');

/** Legacy / demo data lives under this company until assigned otherwise. */
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

/** Resolve company id from employee row (or address object). */
const getCompanyId = (employee) => {
  const addr = getAddress(employee);
  const raw = addr.company_id || addr.companyId || employee?.company_id || null;
  return raw ? String(raw) : DEFAULT_COMPANY_ID;
};

const withCompanyId = (address, companyId) => {
  const addr = (address && typeof address === 'object' && !Array.isArray(address))
    ? { ...address }
    : {};
  addr.company_id = companyId;
  return addr;
};

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
  newCompanyId,
  settingsKey,
  parseSettingsKey,
  getAddress,
};
