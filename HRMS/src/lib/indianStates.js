/**
 * All 28 Indian states + 8 union territories, with Professional Tax (PT)
 * applicability. PT is state-legislated (each state/UT runs its own
 * Professions Tax Act), so this is metadata about which jurisdictions
 * actually levy it — not a slab/rate table. The slabs live in
 * backend/src/payroll/statutory.js (PT_SLAB_STATES below); for any other
 * state that levies PT the company enters its monthly amount in
 * Settings → Payroll — payroll never guesses one.
 *
 * `ptApplicable`:
 *   true    - confident PT is levied here (established, commonly-referenced
 *             state Professions Tax Act)
 *   false   - confident PT is NOT levied here
 *   'verify' - genuinely uncertain from general knowledge alone (recent
 *             legislative change, a newer/reorganized UT, or a less
 *             commonly documented state) — flagged rather than guessed.
 *             Confirm with a tax consultant before relying on this for a
 *             real company: Goa, Punjab, Mizoram, Nagaland,
 *             Jammu & Kashmir, Ladakh.
 *
 * Structured as objects (not flat strings) so a future per-state slab
 * table can key off `code` directly rather than a display-string match.
 */
export const INDIAN_STATES = [
  { code: 'AP', name: 'Andhra Pradesh', ptApplicable: true },
  { code: 'AR', name: 'Arunachal Pradesh', ptApplicable: false },
  { code: 'AS', name: 'Assam', ptApplicable: true },
  { code: 'BR', name: 'Bihar', ptApplicable: true },
  { code: 'CG', name: 'Chhattisgarh', ptApplicable: true },
  { code: 'GA', name: 'Goa', ptApplicable: 'verify' },
  { code: 'GJ', name: 'Gujarat', ptApplicable: true },
  { code: 'HR', name: 'Haryana', ptApplicable: false },
  { code: 'HP', name: 'Himachal Pradesh', ptApplicable: false },
  { code: 'JH', name: 'Jharkhand', ptApplicable: true },
  { code: 'KA', name: 'Karnataka', ptApplicable: true },
  { code: 'KL', name: 'Kerala', ptApplicable: true },
  { code: 'MP', name: 'Madhya Pradesh', ptApplicable: true },
  { code: 'MH', name: 'Maharashtra', ptApplicable: true },
  { code: 'MN', name: 'Manipur', ptApplicable: true },
  { code: 'ML', name: 'Meghalaya', ptApplicable: true },
  { code: 'MZ', name: 'Mizoram', ptApplicable: 'verify' },
  { code: 'NL', name: 'Nagaland', ptApplicable: 'verify' },
  { code: 'OD', name: 'Odisha', ptApplicable: true },
  { code: 'PB', name: 'Punjab', ptApplicable: 'verify' },
  { code: 'RJ', name: 'Rajasthan', ptApplicable: false },
  { code: 'SK', name: 'Sikkim', ptApplicable: true },
  { code: 'TN', name: 'Tamil Nadu', ptApplicable: true },
  { code: 'TG', name: 'Telangana', ptApplicable: true },
  { code: 'TR', name: 'Tripura', ptApplicable: true },
  { code: 'UP', name: 'Uttar Pradesh', ptApplicable: false },
  { code: 'UK', name: 'Uttarakhand', ptApplicable: false },
  { code: 'WB', name: 'West Bengal', ptApplicable: true },
  // ── Union territories ──
  { code: 'AN', name: 'Andaman and Nicobar Islands', ptApplicable: false },
  { code: 'CH', name: 'Chandigarh', ptApplicable: false },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', ptApplicable: false },
  { code: 'DL', name: 'Delhi', ptApplicable: false },
  { code: 'JK', name: 'Jammu and Kashmir', ptApplicable: 'verify' },
  { code: 'LA', name: 'Ladakh', ptApplicable: 'verify' },
  { code: 'LD', name: 'Lakshadweep', ptApplicable: false },
  { code: 'PY', name: 'Puducherry', ptApplicable: true },
];

export const PT_APPLICABLE_LABEL = { true: '', false: ' — PT not applicable', verify: ' — PT applicability unverified, confirm with a tax consultant' };

/** States whose PT slab SpaxSync works out itself (backend/src/payroll/statutory.js). */
export const PT_SLAB_STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Telangana'];

/**
 * What payroll does about PT in a state — mirrors the server:
 *   slab    SpaxSync applies the state's slab
 *   none    no PT is levied (₹0)
 *   manual  PT is levied; the company enters the monthly amount
 *   verify  unclear; the company enters an amount or chooses "No PT"
 *   unknown no state chosen
 */
export function ptKindOf(stateName) {
  const s = INDIAN_STATES.find((st) => st.name === stateName);
  if (!s) return 'unknown';
  if (PT_SLAB_STATES.includes(s.name)) return 'slab';
  if (s.ptApplicable === false) return 'none';
  return s.ptApplicable === 'verify' ? 'verify' : 'manual';
}
