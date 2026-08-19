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
