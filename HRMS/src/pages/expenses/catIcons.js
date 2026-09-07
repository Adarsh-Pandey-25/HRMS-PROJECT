import {
  Plane, Utensils, BedDouble, Briefcase, HeartPulse, Phone, Users, MoreHorizontal,
} from 'lucide-react';

// Keys must match the real reimbursement_type enum values (backend/src/utils/constants.js's
// REIMBURSEMENT_TYPES) — not display labels.
export const CAT_ICON = {
  travel: Plane,
  food: Utensils,
  accommodation: BedDouble,
  office_supplies: Briefcase,
  medical: HeartPulse,
  internet_phone: Phone,
  client_entertainment: Users,
  other: MoreHorizontal,
};
