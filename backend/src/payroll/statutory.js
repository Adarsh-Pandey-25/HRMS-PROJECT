/**
 * Statutory values for payroll, as data with effective dates — never as
 * constants inside the calculation. Values follow
 * docs/Payroll-Industry-Standard-Comparison.txt (law as of 27 Oct 2026) and
 * the states list the app already used; each carries its source and a status.
 * docs/payroll-statutory-values.md lists them for a CA to confirm.
 *
 * Money is in paise. Rates are fractions { num, den } of 1 (12% = 12/100).
 * Dates are 'YYYY-MM-DD'; `to: null` means still in force.
 */

const pct = (num, den) => ({ num, den });

const EPF = [
  {
    id: 'EPF-2014',
    from: '2014-09-01',
    to: '2026-09-16',
    wageCeiling: 15000_00,
    edliWageCeiling: 15000_00,
    employeeRate: pct(12, 100),
    employerRate: pct(12, 100),
    epsRate: pct(833, 10000),
    edliRate: pct(50, 10000),
    adminRate: pct(50, 10000),
    adminMinimumPerEstablishment: 500_00,
    source: 'EPF Scheme 1952; wage ceiling ₹15,000 from 1 Sep 2014',
    status: 'established',
  },
  {
    id: 'EPF-2026-09',
    from: '2026-09-17',
    to: null,
    wageCeiling: 25000_00,
    // The report says EDLI applies on wages up to the ceiling; whether the
    // EDLI ceiling moved with it is on the list to confirm.
    edliWageCeiling: 25000_00,
    employeeRate: pct(12, 100),
    employerRate: pct(12, 100),
    epsRate: pct(833, 10000),
    edliRate: pct(50, 10000),
    adminRate: pct(50, 10000),
    adminMinimumPerEstablishment: 500_00,
    source: 'S.O. 5109(E): EPF wage ceiling ₹25,000 from 17 Sep 2026 (per the 27 Oct 2026 report)',
    status: 'confirm',
  },
];

const ESI = [
  {
    id: 'ESI-2019-07',
    from: '2019-07-01',
    to: null,
    employeeRate: pct(75, 10000),
    employerRate: pct(325, 10000),
    coverageCeiling: 21000_00,
    pwdCoverageCeiling: 25000_00,
    // Employees whose average daily wage is up to this pay no employee share.
    employeeExemptDailyWage: 176_00,
    // Contribution periods: coverage, once it applies, holds to the period's end.
    contributionPeriods: [{ startMonth: 4, endMonth: 9 }, { startMonth: 10, endMonth: 3 }],
    source: 'ESIC: 0.75% / 3.25% from 1 Jul 2019; coverage ₹21,000 (₹25,000 PwD); ₹176/day exemption (per report)',
    status: 'confirm',
  },
];

const OVERTIME = [
  {
    id: 'OT-CODE-2025-11',
    from: '2025-11-21',
    to: null,
    minimumMultiplier: pct(2, 1),
    source: 'Code on Wages 2019 s.14: at least twice the normal rate of wages, where it applies',
    status: 'confirm',
  },
];

/*
 * Professional Tax. `basis`:
 *   monthly      slab on the month's gross; `februaryAmount` replaces the
 *                amount in February where the state collects more then
 *   half_yearly  slab on the half-year's income (April–September, October–March)
 *   none         the state levies no PT
 * A slab applies up to and including `upTo` (paise); `upTo: null` = no limit.
 */
const slab = (upTo, amount, februaryAmount) => ({ upTo, amount, ...(februaryAmount != null ? { februaryAmount } : {}) });

const PT_TABLES = {
  Karnataka: [{
    id: 'PT-KA-2025-04',
    from: '2025-04-01',
    to: null,
    basis: 'monthly',
    slabs: [slab(24999_99, 0), slab(null, 200_00, 300_00)],
    source: 'Karnataka Tax on Professions (Amendment) Act 2025: ₹200 a month from ₹25,000 (₹300 in February), nil below',
    status: 'confirm',
  }],
  Maharashtra: [{
    id: 'PT-MH-2023-04',
    from: '2023-04-01',
    to: null,
    basis: 'monthly',
    slabs: [slab(7500_00, 0), slab(10000_00, 175_00), slab(null, 200_00, 300_00)],
    slabsByGender: { female: [slab(25000_00, 0), slab(null, 200_00, 300_00)] },
    source: 'Maharashtra PT: ₹175 above ₹7,500, ₹200 above ₹10,000 (₹300 in February); women up to ₹25,000 exempt',
    status: 'confirm',
  }],
  'Tamil Nadu': [{
    id: 'PT-TN-CHENNAI-2024-10',
    from: '2024-10-01',
    to: null,
    basis: 'half_yearly',
    slabs: [
      slab(21000_00, 0),
      slab(30000_00, 180_00),
      slab(45000_00, 425_00),
      slab(60000_00, 930_00),
      slab(75000_00, 1025_00),
      slab(null, 1250_00),
    ],
    source: 'Greater Chennai Corporation half-yearly PT (revised H2 FY 2024-25, per report); other local bodies may differ',
    status: 'confirm',
  }],
  Telangana: [{
    id: 'PT-TG',
    from: '2014-06-02',
    to: null,
    basis: 'monthly',
    slabs: [slab(15000_00, 0), slab(20000_00, 150_00), slab(null, 200_00)],
    source: 'Telangana PT slabs (as SpaxSync already used them)',
    status: 'confirm',
  }],
};

/**
 * Every state and union territory, and what the engine knows about its PT:
 *   slab    built-in table above
 *   none    no PT is levied (₹0)
 *   manual  PT is levied but there is no built-in table yet: the company enters the amount
 *   verify  unclear whether PT applies: the company decides (an amount, or no PT)
 * Mirrors HRMS/src/lib/indianStates.js.
 */
const STATES = [
  ['AP', 'Andhra Pradesh', 'manual'], ['AR', 'Arunachal Pradesh', 'none'], ['AS', 'Assam', 'manual'],
  ['BR', 'Bihar', 'manual'], ['CG', 'Chhattisgarh', 'manual'], ['GA', 'Goa', 'verify'],
  ['GJ', 'Gujarat', 'manual'], ['HR', 'Haryana', 'none'], ['HP', 'Himachal Pradesh', 'none'],
  ['JH', 'Jharkhand', 'manual'], ['KA', 'Karnataka', 'slab'], ['KL', 'Kerala', 'manual'],
  ['MP', 'Madhya Pradesh', 'manual'], ['MH', 'Maharashtra', 'slab'], ['MN', 'Manipur', 'manual'],
  ['ML', 'Meghalaya', 'manual'], ['MZ', 'Mizoram', 'verify'], ['NL', 'Nagaland', 'verify'],
  ['OD', 'Odisha', 'manual'], ['PB', 'Punjab', 'verify'], ['RJ', 'Rajasthan', 'none'],
  ['SK', 'Sikkim', 'manual'], ['TN', 'Tamil Nadu', 'slab'], ['TG', 'Telangana', 'slab'],
  ['TR', 'Tripura', 'manual'], ['UP', 'Uttar Pradesh', 'none'], ['UK', 'Uttarakhand', 'none'],
  ['WB', 'West Bengal', 'manual'],
  ['AN', 'Andaman and Nicobar Islands', 'none'], ['CH', 'Chandigarh', 'none'],
  ['DH', 'Dadra and Nagar Haveli and Daman and Diu', 'none'], ['DL', 'Delhi', 'none'],
  ['JK', 'Jammu and Kashmir', 'verify'], ['LA', 'Ladakh', 'verify'], ['LD', 'Lakshadweep', 'none'],
  ['PY', 'Puducherry', 'manual'],
].map(([code, name, pt]) => ({ code, name, pt }));

const inForce = (versions, date) => (versions || []).find((v) => v.from <= date && (v.to == null || date <= v.to)) || null;

const findState = (stateName) => {
  const s = String(stateName || '').trim().toLowerCase();
  if (!s) return null;
  return STATES.find((st) => st.name.toLowerCase() === s || st.code.toLowerCase() === s) || null;
};

const epfRule = (date) => inForce(EPF, date);
const esiRule = (date) => inForce(ESI, date);
const overtimeRule = (date) => inForce(OVERTIME, date);

/** The PT position of a state on a date: { state, kind, rule }. */
const ptRule = (stateName, date) => {
  const state = findState(stateName);
  if (!state) return { state: null, kind: 'unknown', rule: null };
  if (state.pt !== 'slab') return { state, kind: state.pt, rule: null };
  const rule = inForce(PT_TABLES[state.name], date);
  return { state, kind: rule ? 'slab' : 'missing', rule };
};

/** What a payslip records about a rule it used, so it can be reproduced later. */
const ruleRef = (rule) => (rule ? { id: rule.id, from: rule.from, source: rule.source, status: rule.status } : null);

module.exports = {
  EPF,
  ESI,
  OVERTIME,
  PT_TABLES,
  STATES,
  epfRule,
  esiRule,
  overtimeRule,
  ptRule,
  findState,
  ruleRef,
};
