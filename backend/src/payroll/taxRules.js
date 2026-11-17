/**
 * Income-tax rates for salary TDS (Income-tax Act 2025, section 392), as data
 * per tax year — never as constants inside the calculation. Values follow
 * docs/Payroll-Industry-Standard-Comparison.txt §3.4 (slabs unchanged for tax
 * year 2026-27); each carries its source and status, and
 * docs/payroll-statutory-values.md lists them for a CA to confirm.
 *
 * Money in paise; rates as whole percentages.
 *   slabs       a band taxes income above the previous `upTo` up to its own `upTo`
 *   rebate      tax is nil up to `incomeUpTo` (capped at `maxRebate`); with
 *               `marginalRelief`, tax just above the limit never exceeds the
 *               income above it
 *   surcharge   % of tax above each threshold, with marginal relief at each
 *   cess        % of tax + surcharge
 */
const L = 100000_00; // ₹1 lakh in paise

const NEW_REGIME = {
  standardDeduction: 75000_00,
  slabs: [
    { upTo: 4 * L, rate: 0 },
    { upTo: 8 * L, rate: 5 },
    { upTo: 12 * L, rate: 10 },
    { upTo: 16 * L, rate: 15 },
    { upTo: 20 * L, rate: 20 },
    { upTo: 24 * L, rate: 25 },
    { upTo: null, rate: 30 },
  ],
  rebate: { incomeUpTo: 12 * L, maxRebate: 60000_00, marginalRelief: true },
  surcharge: [
    { above: 50 * L, rate: 10 },
    { above: 100 * L, rate: 15 },
    { above: 200 * L, rate: 25 }, // the new regime caps surcharge at 25%
  ],
  cess: 4,
  // Under the new regime salary deductions such as Professional Tax and
  // Chapter VIII claims are not allowed — only the standard deduction.
  allowsDeclarations: false,
};

const OLD_REGIME = {
  standardDeduction: 50000_00,
  slabs: [
    { upTo: 2.5 * L, rate: 0 },
    { upTo: 5 * L, rate: 5 },
    { upTo: 10 * L, rate: 20 },
    { upTo: null, rate: 30 },
  ],
  // Higher nil band for residents aged 60–79 ('senior') and 80+ ('super_senior')
  // at any time in the tax year (secondary sources, 2 Nov 2026 — for a CA to confirm).
  slabsByAge: {
    senior: [
      { upTo: 3 * L, rate: 0 },
      { upTo: 5 * L, rate: 5 },
      { upTo: 10 * L, rate: 20 },
      { upTo: null, rate: 30 },
    ],
    super_senior: [
      { upTo: 5 * L, rate: 0 },
      { upTo: 10 * L, rate: 20 },
      { upTo: null, rate: 30 },
    ],
  },
  rebate: { incomeUpTo: 5 * L, maxRebate: 12500_00, marginalRelief: false },
  surcharge: [
    { above: 50 * L, rate: 10 },
    { above: 100 * L, rate: 15 },
    { above: 200 * L, rate: 25 },
    { above: 500 * L, rate: 37 },
  ],
  cess: 4,
  allowsDeclarations: true, // HRA, LTA, 80C-type deductions, Professional Tax
};

/**
 * What a leaver is paid that is tax-free, under both regimes, for employees
 * other than government's (the 1961 Act's s.10(10) and s.10(10AA), carried
 * into the Income-tax Act 2025). The limits are for a person's whole working
 * life, across employers (payroll/retirementExemption.js).
 *   gratuityLimit               gratuity: at most ₹20 lakh tax-free
 *   gratuityNotCovered          not covered by the Payment of Gratuity Act: half a
 *                               month's average salary for each completed year
 *   leaveEncashmentLimit        leave encashed on retirement or resignation: at
 *                               most ₹25 lakh tax-free (from 1 April 2023)
 *   averageSalaryMonths         the average salary (Basic + DA) is of the 10
 *                               months before leaving; encashment at most 10 of them
 *   leaveDaysPerCompletedYear   leave counted at most 30 days for each completed year
 */
const RETIREMENT_EXEMPTIONS = {
  gratuityLimit: 20 * L,
  gratuityNotCovered: { num: 1, den: 2 },
  leaveEncashmentLimit: 25 * L,
  averageSalaryMonths: 10,
  leaveDaysPerCompletedYear: 30,
  source: 'Income-tax Act 1961 s.10(10)(ii)/(iii) and s.10(10AA)(ii) (₹25 lakh, CBDT notification 31/2023), carried into the Income-tax Act 2025',
  status: 'confirm',
};

const TAX_YEARS = [
  {
    id: 'IT-2025-26',
    taxYear: '2025-26',
    from: '2025-04-01',
    to: '2026-03-31',
    regimes: { new: NEW_REGIME, old: OLD_REGIME },
    retirement: RETIREMENT_EXEMPTIONS,
    source: 'Finance Act 2025 slabs (Income-tax Act 1961, s.192)',
    status: 'confirm',
  },
  {
    id: 'IT-2026-27',
    taxYear: '2026-27',
    from: '2026-04-01',
    to: '2027-03-31',
    regimes: { new: NEW_REGIME, old: OLD_REGIME },
    retirement: RETIREMENT_EXEMPTIONS,
    source: 'Income-tax Act 2025, s.392; slabs unchanged for tax year 2026-27 (per the 27 Oct 2026 report)',
    status: 'confirm',
  },
];

/** The tax year (April–March) a calendar month falls in, e.g. October 2026 → '2026-27'. */
const taxYearOf = (month, year) => {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** Months left in the tax year including this one: April 12 … March 1. */
const monthsLeftInTaxYear = (month) => (month >= 4 ? 16 - month : 4 - month);

const taxRulesFor = (month, year) => TAX_YEARS.find((t) => t.taxYear === taxYearOf(month, year)) || null;

/** The tax-free limits on a leaver's pay for a month's tax year (the latest year set up, if that one isn't). */
const retirementExemptionsFor = (month, year) => (taxRulesFor(month, year) || TAX_YEARS[TAX_YEARS.length - 1]).retirement;

module.exports = {
  TAX_YEARS, NEW_REGIME, OLD_REGIME, RETIREMENT_EXEMPTIONS, taxYearOf, monthsLeftInTaxYear, taxRulesFor, retirementExemptionsFor,
};
