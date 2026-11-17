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
 *   monthly      slab on the month's gross
 *   annual       slab on the year's salary, taken as the month's contract
 *                gross × 12 (the full month's pay before loss of pay, without
 *                overtime or one-time pay), so the slab stays the same all
 *                year while the salary does; its `amount` is deducted each
 *                month (Madhya Pradesh)
 *   half_yearly  slab on the half-year's income (April–September, October–March)
 *   none         the state levies no PT (from `from`)
 * A slab applies up to and including `upTo` (paise); `upTo: null` = no limit.
 * Where a state collects a different amount in one month so that the year
 * comes to its total, the slab says so: `februaryAmount` (Maharashtra,
 * Karnataka) or `marchAmount`, the last month of the financial year
 * (Madhya Pradesh).
 * `status`: confirmed (an official source was read and matches),
 * corroborated (two or more secondary sources agree), confirm (still to be
 * confirmed with a CA). `url` is the source read.
 */
const slab = (upTo, amount, { february, march } = {}) => ({
  upTo,
  amount,
  ...(february != null ? { februaryAmount: february } : {}),
  ...(march != null ? { marchAmount: march } : {}),
});

/**
 * Art. 276(2): no one pays more than ₹2,500 of PT in a year (the financial
 * year, April–March, as the states count it). No table comes to more over a
 * full year; the engine also stops a month's PT at what is left of it.
 */
const PT_ANNUAL_CAP = {
  amount: 2500_00,
  source: 'Constitution of India Art. 276(2), as amended by the Sixtieth Amendment Act 1988',
  status: 'established',
};

const PT_TABLES = {
  Karnataka: [{
    id: 'PT-KA-2023-04',
    from: '2023-04-01',
    to: '2025-03-31',
    basis: 'monthly',
    slabs: [slab(24999_99, 0), slab(null, 200_00)],
    source: 'Karnataka Act 14 of 2023: ₹200 a month from ₹25,000 (₹25,000 itself taxed), nil below, from 1 Apr 2023',
    url: 'https://gst.karnataka.gov.in/Documents/General/ptnotificationact29323.pdf',
    status: 'confirmed',
  }, {
    id: 'PT-KA-2025-04',
    from: '2025-04-01',
    to: null,
    basis: 'monthly',
    slabs: [slab(24999_99, 0), slab(null, 200_00, { february: 300_00 })],
    source: 'Karnataka Act 14 of 2023: ₹200 a month from ₹25,000, nil below (from 1 Apr 2023); Act 33 of 2025: ₹300 in February (from 1 Apr 2025)',
    url: 'https://gst.karnataka.gov.in/Documents/General/ptnotificationact29323.pdf',
    status: 'confirmed',
  }],
  Maharashtra: [{
    id: 'PT-MH-2023-04',
    from: '2023-04-01',
    to: null,
    basis: 'monthly',
    slabs: [slab(7500_00, 0), slab(10000_00, 175_00), slab(null, 200_00, { february: 300_00 })],
    slabsByGender: { female: [slab(25000_00, 0), slab(null, 200_00, { february: 300_00 })] },
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
    source: 'Telangana Tax on Professions Act 1987, First Schedule as amended (the schedule inherited from AP Act 12 of 2013)',
    url: 'https://tgct.gov.in/tgportal/AllActs/APPT/APPTSchedule.aspx',
    status: 'confirmed',
  }],
  'Andhra Pradesh': [{
    id: 'PT-AP-2013-02',
    from: '2013-02-06',
    to: null,
    basis: 'monthly',
    slabs: [slab(15000_00, 0), slab(20000_00, 150_00), slab(null, 200_00)],
    source: 'AP Tax on Professions (Amendment) Act 12 of 2013, First Schedule, deemed in force from 6 Feb 2013 (the official apct.gov.in page could not be read)',
    url: 'https://www.greythr.com/wiki/acts/professional-tax-andhra-pradesh',
    status: 'corroborated',
  }],
  Gujarat: [{
    id: 'PT-GJ-2022-04',
    from: '2022-04-01',
    to: null,
    basis: 'monthly',
    slabs: [slab(12000_00, 0), slab(null, 200_00)],
    source: 'Gujarat Finance Dept notification under s.3(2), 8 Apr 2022, in force from 1 Apr 2022: ₹200 a month above ₹12,000, nil up to ₹12,000',
    url: 'https://commercialtax.gujarat.gov.in/vatwebsite/download/schedule/Rate_of_Profession_Tax.pdf',
    status: 'confirmed',
  }],
  'Madhya Pradesh': [{
    id: 'PT-MP-2018-04',
    from: '2018-04-01',
    to: null,
    basis: 'annual',
    slabs: [
      slab(225000_00, 0),
      slab(300000_00, 125_00),
      slab(400000_00, 166_00, { march: 174_00 }),
      slab(null, 208_00, { march: 212_00 }),
    ],
    source: 'MP Vritti Kar Adhiniyam 1995 as amended by MP Act 20 of 2018 (from 1 Apr 2018): a year\'s salary up to ₹2,25,000 nil; ₹1,500; ₹2,000 (₹166 × 11 + ₹174); above ₹4,00,000 ₹2,500 (₹208 × 11 + ₹212). The year is the financial year, so the twelfth month is March',
    url: 'https://mptax.mp.gov.in/mpvatweb/download/home/MPCTD_Registration_Checklist&_Rates.pdf',
    status: 'confirmed',
  }],
  Kerala: [{
    id: 'PT-KL-2024-10',
    from: '2024-10-01',
    to: null,
    basis: 'half_yearly',
    slabs: [
      slab(11999_99, 0),
      slab(17999_99, 320_00),
      slab(29999_99, 450_00),
      slab(44999_99, 600_00),
      slab(99999_99, 750_00),
      slab(124999_99, 1000_00),
      slab(null, 1250_00),
    ],
    source: 'Kerala LSGD G.O.(Rt) 1149/2024/LSGD, 27 Jun 2024, from 1 Oct 2024. Levied by the local body: most local bodies; check yours (the Profession Tax Rules let a local body levy less)',
    url: 'https://go.lsgkerala.gov.in/files/go20240627_37169.pdf',
    localBody: true,
    status: 'confirmed',
  }],
  'West Bengal': [{
    id: 'PT-WB-2016-08',
    from: '2016-08-01',
    to: '2026-09-30',
    basis: 'monthly',
    slabs: [slab(10000_00, 0), slab(15000_00, 110_00), slab(25000_00, 130_00), slab(40000_00, 150_00), slab(null, 200_00)],
    source: 'West Bengal PT schedule from 1 Apr 2014 (Finance Act 2014), with ₹8,501–10,000 nil from 1 Aug 2016 (682-L, 28 Jul 2016)',
    url: 'https://comtax.wb.gov.in/Ptax-Schedule-New_(w.e.f._1-4-2014).pdf',
    status: 'confirmed',
  }, {
    id: 'PT-WB-2026-10',
    from: '2026-10-01',
    to: null,
    basis: 'monthly',
    slabs: [slab(20000_00, 0), slab(30000_00, 100_00), slab(50000_00, 140_00), slab(100000_00, 170_00), slab(null, 208_00)],
    source: 'West Bengal Notification 1607-F.T., 16 Sep 2026 (Finance Act 2026), from 1 Oct 2026; the slabs match the official draft 1407-F.T. of 18 Aug 2026, the final notification is from secondary sources',
    url: 'https://comtax.wb.gov.in/pdf/SAR-470_Finance%20Dept(Rev)_1407-FT.pdf',
    status: 'corroborated',
  }],
  Odisha: [{
    id: 'PT-OD-2026-04',
    from: '2026-04-01',
    to: null,
    basis: 'none',
    slabs: [],
    source: 'Odisha State Tax on Professions, Trades, Callings and Employment (Repeal) Ordinance 2026 (Ordinance 2 of 2026, gazette 21 Apr 2026): no PT from 1 Apr 2026. The repeal bill was reported passed on 28 Sep 2026; its assent was not seen',
    url: 'https://www.scconline.com/blog/post/2026/04/23/odisha-repeals-levy-of-professional-tax-effective-from-1-april-2026/',
    status: 'confirmed',
  }],
};

/**
 * Every state and union territory, and what the engine knows about its PT
 * on a date no PT_TABLES version covers:
 *   slab    the state has a built-in table above; a date before its first
 *           version is 'missing' (the company enters the amount)
 *   none    no PT is levied (₹0)
 *   manual  PT is levied but there is no built-in table: the company enters the amount
 *   verify  unclear whether PT applies: the company decides (an amount, or no PT)
 * A table version in force always wins: Odisha is manual up to 31 Mar 2026,
 * then its table says no PT.
 * Mirrors HRMS/src/lib/indianStates.js.
 */
const STATES = [
  ['AP', 'Andhra Pradesh', 'slab'], ['AR', 'Arunachal Pradesh', 'none'], ['AS', 'Assam', 'manual'],
  ['BR', 'Bihar', 'manual'], ['CG', 'Chhattisgarh', 'manual'], ['GA', 'Goa', 'verify'],
  ['GJ', 'Gujarat', 'slab'], ['HR', 'Haryana', 'none'], ['HP', 'Himachal Pradesh', 'none'],
  ['JH', 'Jharkhand', 'manual'], ['KA', 'Karnataka', 'slab'], ['KL', 'Kerala', 'slab'],
  ['MP', 'Madhya Pradesh', 'slab'], ['MH', 'Maharashtra', 'slab'], ['MN', 'Manipur', 'manual'],
  ['ML', 'Meghalaya', 'manual'], ['MZ', 'Mizoram', 'verify'], ['NL', 'Nagaland', 'verify'],
  ['OD', 'Odisha', 'manual'], ['PB', 'Punjab', 'verify'], ['RJ', 'Rajasthan', 'none'],
  ['SK', 'Sikkim', 'manual'], ['TN', 'Tamil Nadu', 'slab'], ['TG', 'Telangana', 'slab'],
  ['TR', 'Tripura', 'manual'], ['UP', 'Uttar Pradesh', 'none'], ['UK', 'Uttarakhand', 'none'],
  ['WB', 'West Bengal', 'slab'],
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

/**
 * The PT position of a state on a date: { state, kind, rule }. A table in
 * force decides (its slabs, or no PT); otherwise the state's standing kind.
 */
const ptRule = (stateName, date) => {
  const state = findState(stateName);
  if (!state) return { state: null, kind: 'unknown', rule: null };
  const rule = inForce(PT_TABLES[state.name], date);
  if (rule) return { state, kind: rule.basis === 'none' ? 'none' : 'slab', rule };
  return { state, kind: state.pt === 'slab' ? 'missing' : state.pt, rule: null };
};

/** What a payslip records about a rule it used, so it can be reproduced later. */
const ruleRef = (rule) => (rule ? { id: rule.id, from: rule.from, source: rule.source, status: rule.status } : null);

module.exports = {
  EPF,
  ESI,
  OVERTIME,
  PT_ANNUAL_CAP,
  PT_TABLES,
  STATES,
  epfRule,
  esiRule,
  overtimeRule,
  ptRule,
  findState,
  ruleRef,
};
