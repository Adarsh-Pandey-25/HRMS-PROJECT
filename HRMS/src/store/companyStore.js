import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Blank defaults — onboarding should not pre-fill another company's demo data. */
const EMPTY_COMPANY = {
  name: '',
  industry: '',
  size: '',
  foundedYear: '',
  website: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelation: '',
  logoName: null,
  logoPath: null,
  logoUrl: null,
  brandIconName: null,
  brandIconPath: null,
  brandIconUrl: null,
  brandColor: '#6C63FF',
  tagline: '',
  fyStart: 'April',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  legalName: '',
  gstin: '',
  pan: '',
  cin: '',
  tan: '',
  incorporationDate: '',
  natureOfBusiness: '',
  directors: [],
  founders: [],
  adminName: '',
  adminEmail: '',
  companyId: null,
};

// Drives the first-run boot flow: /welcome -> /onboarding -> /login -> /dashboard.
export const useCompanyStore = create(
  persist(
    (set) => ({
      onboarded: false,
      company: { ...EMPTY_COMPANY },

      completeOnboarding: (company) => set({
        company: { ...EMPTY_COMPANY, ...company },
        onboarded: true,
      }),
      resetOnboarding: () => set({ onboarded: false, company: { ...EMPTY_COMPANY } }),
      updateCompany: (patch) => set((s) => {
        const next = { ...s.company, ...patch };
        // Never let a partial hydrate wipe a logo we already have.
        if (!next.logoPath && s.company.logoPath) next.logoPath = s.company.logoPath;
        if (!next.logoUrl && s.company.logoUrl) next.logoUrl = s.company.logoUrl;
        if (!next.logoName && s.company.logoName) next.logoName = s.company.logoName;
        if (!next.brandIconPath && s.company.brandIconPath) next.brandIconPath = s.company.brandIconPath;
        if (!next.brandIconUrl && s.company.brandIconUrl) next.brandIconUrl = s.company.brandIconUrl;
        if (!next.brandIconName && s.company.brandIconName) next.brandIconName = s.company.brandIconName;
        return { company: next };
      }),
    }),
    {
      name: 'zenith-company',
      version: 2,
      migrate: (persisted) => {
        // Drop old Acme demo seed so a new workspace starts clean
        if (!persisted || typeof persisted !== 'object') {
          return { onboarded: false, company: { ...EMPTY_COMPANY } };
        }
        const name = persisted.company?.name;
        if (name === 'Acme Technologies Pvt. Ltd.') {
          return { onboarded: false, company: { ...EMPTY_COMPANY } };
        }
        return {
          onboarded: Boolean(persisted.onboarded),
          company: { ...EMPTY_COMPANY, ...(persisted.company || {}) },
        };
      },
    }
  )
);
