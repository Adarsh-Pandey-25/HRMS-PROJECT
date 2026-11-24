import { INDIAN_STATES } from './indianStates';

/** Corporate due-diligence fields stored on company_profile. */

export const EMPTY_LEGAL_PROFILE = {
  legalName: '',
  gstin: '',
  pan: '',
  cin: '',
  tan: '',
  incorporationDate: '',
  natureOfBusiness: '',
  directors: [],
  founders: [],
};

export function mergeLegalProfile(source = {}) {
  const directors = Array.isArray(source.directors) ? source.directors : [];
  const founders = Array.isArray(source.founders) ? source.founders : [];
  return {
    ...EMPTY_LEGAL_PROFILE,
    legalName: source.legalName || '',
    gstin: source.gstin || '',
    pan: source.pan || '',
    cin: source.cin || '',
    tan: source.tan || '',
    incorporationDate: source.incorporationDate || '',
    natureOfBusiness: source.natureOfBusiness || '',
    directors: directors.map((p, i) => ({
      id: p.id || `dir-${i}`,
      name: p.name || '',
      din: p.din || '',
      designation: p.designation || '',
    })),
    founders: founders.map((p, i) => ({
      id: p.id || `fnd-${i}`,
      name: p.name || '',
      role: p.role || '',
    })),
  };
}

export function formatRegisteredAddress(profile) {
  if (!profile) return '';
  return [
    profile.addressLine1,
    profile.addressLine2,
    [profile.city, profile.state].filter(Boolean).join(', '),
    profile.pincode,
    profile.country,
  ].filter((part) => String(part || '').trim()).join('\n');
}

export function newDirector() {
  return { id: `dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: '', din: '', designation: 'Director' };
}

export function newFounder() {
  return { id: `fnd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: '', role: 'Founder' };
}

/**
 * Details a subsidiary must have (owner, 24 Nov 2026); the primary company
 * isn't held to them. Mirrors SUBSIDIARY_REQUIRED in
 * backend/src/services/company.service.js, which refuses a save without them.
 */
export const SUBSIDIARY_REQUIRED = [
  { key: 'legalName', label: 'Legal name' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'PIN code' },
  { key: 'pan', label: 'PAN' },
  { key: 'contactEmail', label: 'Contact email' },
  { key: 'website', label: 'Website' },
];

export const SUBSIDIARY_REQUIRED_KEYS = SUBSIDIARY_REQUIRED.map((f) => f.key);

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const websiteDomain = (value) => String(value || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^www\./, '')
  .split(/[/?#]/)[0];
const isIndianState = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return INDIAN_STATES.some((s) => s.name.toLowerCase() === v || s.code.toLowerCase() === v);
};

// Why a filled-in value can't be used (null when it can).
const FORMAT_PROBLEM = {
  state: (v) => (isIndianState(v) ? null : 'Choose an Indian state'),
  pincode: (v) => (/^\d{6}$/.test(v) ? null : 'PIN code must be 6 digits'),
  pan: (v) => (PAN_PATTERN.test(v.toUpperCase()) ? null : '5 letters, 4 digits, 1 letter (like ABCDE1234F)'),
  contactEmail: (v) => (EMAIL_PATTERN.test(v) ? null : 'Enter a valid email address'),
  website: (v) => (DOMAIN_PATTERN.test(websiteDomain(v)) ? null : 'Enter the company\'s domain, like acme.in'),
};

/** { key: message } for each required subsidiary detail in `form` that is blank or malformed. */
export function subsidiaryDetailErrors(form) {
  const errors = {};
  SUBSIDIARY_REQUIRED.forEach(({ key }) => {
    const value = String(form?.[key] ?? '').trim();
    const problem = value ? FORMAT_PROBLEM[key](value) : 'Required';
    if (problem) errors[key] = problem;
  });
  return errors;
}

/** Labels for the server's missingDetails keys, in form order. */
export function missingDetailLabels(keys) {
  const set = new Set(keys || []);
  return SUBSIDIARY_REQUIRED.filter((f) => set.has(f.key)).map((f) => f.label);
}

/** Indian state names for a select; a saved value not in the list is kept as an option. */
export function stateOptions(current) {
  const names = INDIAN_STATES.map((s) => s.name);
  const value = String(current || '').trim();
  return value && !names.includes(value) ? [value, ...names] : names;
}
