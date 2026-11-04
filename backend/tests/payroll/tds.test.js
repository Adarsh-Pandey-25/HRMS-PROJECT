/**
 * Salary TDS by projection (backend/src/payroll/tds.js). Expected rupee
 * figures were worked out by hand first; the working is in the comments.
 */
const {
  resolveTaxProfile, ageBandInTaxYear, futureMonthsFor, projectMonthlyTds, steadyStateHistory,
} = require('../../src/payroll/tds');
const { annualTax } = require('../../src/payroll/incomeTax');
const { NEW_REGIME, OLD_REGIME, monthsLeftInTaxYear } = require('../../src/payroll/taxRules');

const R = (rupees) => Math.round(rupees * 100);
const NEW = resolveTaxProfile({}, '2026-27');
const profileWith = (year) => resolveTaxProfile({ tax_profile: { years: { '2026-27': year } } }, '2026-27');
const history = (h = {}) => ({
  salaryPaid: 0, tdsPaid: 0, ptPaid: 0, earlierDrafts: [], ...h,
});

describe('the tax profile', () => {
  test('new regime and nothing declared unless recorded', () => {
    expect(NEW.regime).toBe('new');
    expect(NEW.regimeChosen).toBe(false);
    expect(NEW.previous_employer_income).toBe(0);
    expect(NEW.chapter8_deductions).toBe(0);
  });
  test('a recorded year: rupees in, paise out; other years untouched', () => {
    const p = profileWith({ regime: 'old', previous_employer_income: 600000, previous_employer_tds: 20000.5, other_income: -5 });
    expect(p.regime).toBe('old');
    expect(p.regimeChosen).toBe(true);
    expect(p.previous_employer_income).toBe(R(600000));
    expect(p.previous_employer_tds).toBe(R(20000.5));
    expect(p.other_income).toBe(0); // negative ignored
    expect(resolveTaxProfile({ tax_profile: { years: { '2026-27': { regime: 'old' } } } }, '2027-28').regime).toBe('new');
  });
});

describe('age and months', () => {
  test('age at any time in the tax year (a 1 April birthday counts as reached on 31 March)', () => {
    expect(ageBandInTaxYear('1966-04-02', '2026-27')).toBe('senior'); // 60 on 2 Apr 2026
    expect(ageBandInTaxYear('1967-03-31', '2026-27')).toBe('senior'); // 60 on 31 Mar 2027
    expect(ageBandInTaxYear('1967-04-01', '2026-27')).toBe('senior'); // reaches 60 on 31 Mar 2027 by law
    expect(ageBandInTaxYear('1967-04-02', '2026-27')).toBe('under_60');
    expect(ageBandInTaxYear('1947-04-01', '2026-27')).toBe('super_senior'); // reaches 80 on 31 Mar 2027
    expect(ageBandInTaxYear('1947-04-02', '2026-27')).toBe('senior');
    expect(ageBandInTaxYear(null, '2026-27')).toBe(null);
  });
  test('months still to come after this one, stopping at a known last working day', () => {
    expect(futureMonthsFor(10, 2026, null)).toBe(5); // Nov … Mar
    expect(futureMonthsFor(4, 2026, null)).toBe(11);
    expect(futureMonthsFor(3, 2027, null)).toBe(0);
    expect(futureMonthsFor(10, 2026, '2026-10-15')).toBe(0); // leaving this month
    expect(futureMonthsFor(10, 2026, '2027-01-15')).toBe(3); // Nov, Dec, Jan
    expect(futureMonthsFor(10, 2026, '2027-06-30')).toBe(5); // after the tax year: to March
    expect(futureMonthsFor(10, 2026, '2026-09-30')).toBe(0);
  });
});

describe('this month\'s TDS', () => {
  test("the report's Example 2: ₹2 lakh a month, October, ₹1,46,250 deducted so far → ₹24,375", () => {
    const t = projectMonthlyTds({
      month: 10,
      year: 2026,
      profile: NEW,
      thisMonth: R(200000),
      futureMonthly: R(200000),
      futureMonths: 5,
      history: history({ salaryPaid: R(1200000), tdsPaid: R(146250) }),
      payAfterDeductions: R(196800),
    });
    expect(t.blockers).toEqual([]);
    expect(t.tds).toBe(R(24375));
    expect(t.worksheet).toMatchObject({
      tax_year: '2026-27', regime: 'new', months_left: 6, projected_salary: R(2400000), standard_deduction: R(75000),
      taxable_income: R(2325000), annual_tax: R(292500), tds_before: R(146250), remaining: R(146250), tds: R(24375), shortfall: 0,
    });
  });

  test('a previous employer\'s salary and TDS count: joiner in October, ₹8 lakh and ₹20,000 earlier, ₹1.5 lakh a month here', () => {
    // 8,00,000 + 6 × 1,50,000 = 17,00,000 − 75,000 = 16,25,000
    // tax 20,000 + 40,000 + 60,000 + 20% × 25,000 (5,000) = 1,25,000 + cess 5,000 = 1,30,000
    // (1,30,000 − 20,000) ÷ 6 = 18,333.33 → 18,333
    const t = projectMonthlyTds({
      month: 10,
      year: 2026,
      profile: profileWith({ previous_employer_income: 800000, previous_employer_tds: 20000 }),
      thisMonth: R(150000),
      futureMonthly: R(150000),
      futureMonths: 5,
      history: history(),
    });
    expect(t.worksheet.annual_tax).toBe(R(130000));
    expect(t.worksheet.tds_before).toBe(R(20000));
    expect(t.tds).toBe(R(18333));
  });

  test('old regime: Professional Tax and the allowed deductions come off', () => {
    // ₹1 lakh a month from April, Karnataka PT ₹200 a month, ₹2.5 lakh allowed deductions:
    // 12,00,000 − 50,000 − 2,400 − 2,50,000 = 8,97,600
    // 12,500 + 20% × 3,97,600 (79,520) = 92,020 + cess 3,680.80 = 95,700.80 → to ₹10: 95,700; ÷ 12 = 7,975
    const t = projectMonthlyTds({
      month: 4,
      year: 2026,
      profile: profileWith({ regime: 'old', chapter8_deductions: 150000, hra_exemption: 100000 }),
      dateOfBirth: '1990-05-05',
      thisMonth: R(100000),
      futureMonthly: R(100000),
      futureMonths: 11,
      ptThisMonth: R(200),
      ptFutureMonthly: R(200),
      history: history(),
    });
    expect(t.warnings).toEqual([]);
    expect(t.worksheet.professional_tax).toBe(R(2400));
    expect(t.worksheet.exemptions_and_deductions).toBe(R(250000));
    expect(t.worksheet.taxable_income).toBe(R(897600));
    expect(t.worksheet.annual_tax).toBe(R(95700));
    expect(t.tds).toBe(R(7975));
  });

  test('old regime by age: 60–79 and 80+ have a higher nil band', () => {
    // October, ₹1 lakh a month, ₹6 lakh paid April–September → 12,00,000 − 50,000 = 11,50,000 taxable
    const run = (dateOfBirth) => projectMonthlyTds({
      month: 10,
      year: 2026,
      profile: profileWith({ regime: 'old' }),
      dateOfBirth,
      thisMonth: R(100000),
      futureMonthly: R(100000),
      futureMonths: 5,
      history: history({ salaryPaid: R(600000) }),
    });
    // under 60: 12,500 + 1,00,000 + 30% × 1,50,000 (45,000) = 1,57,500 + cess 6,300 = 1,63,800 ÷ 6 = 27,300
    const young = run('1990-01-01');
    expect(young.worksheet).toMatchObject({ age_band: 'under_60', taxable_income: R(1150000), annual_tax: R(163800) });
    expect(young.tds).toBe(R(27300));
    // 60–79 (nil to ₹3 lakh): 10,000 + 1,00,000 + 45,000 = 1,55,000 + cess 6,200 = 1,61,200 ÷ 6 = 26,866.67 → 26,867
    const senior = run('1960-01-01');
    expect(senior.blockers).toEqual([]);
    expect(senior.worksheet).toMatchObject({ age_band: 'senior', annual_tax: R(161200) });
    expect(senior.tds).toBe(R(26867));
    // 80+ (nil to ₹5 lakh): 1,00,000 + 45,000 = 1,45,000 + cess 5,800 = 1,50,800 ÷ 6 = 25,133.33 → 25,133
    const superSenior = run('1940-01-01');
    expect(superSenior.worksheet).toMatchObject({ age_band: 'super_senior', annual_tax: R(150800) });
    expect(superSenior.tds).toBe(R(25133));
    // The new regime has no age bands.
    expect(projectMonthlyTds({
      month: 10, year: 2026, profile: NEW, dateOfBirth: '1940-01-01', thisMonth: R(100000), futureMonthly: R(100000), futureMonths: 5, history: history({ salaryPaid: R(600000) }),
    }).worksheet.age_band).toBe(null);
  });

  test("a leaver's last month settles the year: December, ₹2 lakh a month, nothing deducted before", () => {
    // 9 × 2,00,000 = 18,00,000 − 75,000 = 17,25,000
    // 20,000 + 40,000 + 60,000 + 20% × 1,25,000 (25,000) = 1,45,000 + cess 5,800 = 1,50,800, all now
    const t = projectMonthlyTds({
      month: 12,
      year: 2026,
      profile: NEW,
      thisMonth: R(200000),
      futureMonthly: R(200000),
      futureMonths: 0,
      history: history({ salaryPaid: R(1600000) }),
      payAfterDeductions: R(196800),
    });
    expect(t.worksheet.months_left).toBe(1);
    expect(t.tds).toBe(R(150800));
  });

  test('never more than the pay left; in the last month the rest is reported as not deducted', () => {
    const t = projectMonthlyTds({
      month: 12,
      year: 2026,
      profile: NEW,
      thisMonth: R(200000),
      futureMonthly: R(200000),
      futureMonths: 0,
      history: history({ salaryPaid: R(1600000) }),
      payAfterDeductions: R(100000),
    });
    expect(t.tds).toBe(R(100000));
    expect(t.worksheet.shortfall).toBe(R(50800));
    expect(t.warnings.map((w) => w.code)).toEqual(['tds_capped']);
    expect(t.warnings[0].message).toMatch(/could not be deducted/);
  });

  test('more deducted so far than the year needs → nothing this month', () => {
    expect(projectMonthlyTds({
      month: 10, year: 2026, profile: NEW, thisMonth: R(40000), futureMonthly: R(40000), futureMonths: 5, history: history({ salaryPaid: R(240000), tdsPaid: R(5000) }),
    }).tds).toBe(0);
  });

  test('refuses rather than guesses', () => {
    const draft = projectMonthlyTds({
      month: 10, year: 2026, profile: NEW, thisMonth: R(200000), futureMonthly: R(200000), futureMonths: 5, history: history({ earlierDrafts: [{ month: 9, year: 2026 }] }),
    });
    expect(draft.blockers.map((b) => b.code)).toEqual(['tds_earlier_draft']);
    expect(draft.tds).toBe(0);

    const noRates = projectMonthlyTds({
      month: 4, year: 2027, profile: resolveTaxProfile({}, '2027-28'), thisMonth: R(200000), futureMonthly: R(200000), futureMonths: 11, history: history(),
    });
    expect(noRates.blockers.map((b) => b.code)).toEqual(['tax_rules_missing']);

    const unknownAge = projectMonthlyTds({
      month: 10, year: 2026, profile: profileWith({ regime: 'old' }), thisMonth: R(100000), futureMonthly: R(100000), futureMonths: 5, history: history(),
    });
    expect(unknownAge.blockers).toEqual([]);
    expect(unknownAge.warnings.map((w) => w.code)).toEqual(['tax_age_unknown']);
  });
});

describe('a sample salary: as if paid every month since April', () => {
  test('₹1.5 lakh a month: April–September deduct 12,567 × 5 + 12,566; October 12,567', () => {
    // 18,00,000 − 75,000 = 17,25,000 → 1,50,800 for the year, 12,566.67 a month, spread to the rupee:
    // Apr 12,567 · May 12,567 · Jun 12,567 · Jul 12,567 · Aug 12,567 (12,566.5) · Sep 12,566 · Oct 12,567 (12,566.5)
    const h = steadyStateHistory({ month: 10, year: 2026, profile: NEW, monthly: R(150000) });
    expect(h.salaryPaid).toBe(R(900000));
    expect(h.tdsPaid).toBe(R(75401));
    expect(h.assumedFullYear).toBe(true);
    const t = projectMonthlyTds({
      month: 10, year: 2026, profile: NEW, thisMonth: R(150000), futureMonthly: R(150000), futureMonths: 5, history: h,
    });
    expect(t.tds).toBe(R(12567));
    expect(t.worksheet.assumed_full_year).toBe(true);
  });
  test('April has nothing before it', () => {
    expect(steadyStateHistory({ month: 4, year: 2026, profile: NEW, monthly: R(150000) }).tdsPaid).toBe(0);
  });
});

/** Runs a whole tax year month by month the way payroll does: each month's TDS from the published months before it. */
const runYear = (monthlyPay, profile = NEW, dateOfBirth = '1990-01-01') => {
  const h = history();
  const tds = [];
  const months = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  months.forEach((month, i) => {
    const year = month >= 4 ? 2026 : 2027;
    const t = projectMonthlyTds({
      month,
      year,
      profile,
      dateOfBirth,
      thisMonth: monthlyPay[i],
      futureMonthly: monthlyPay[i],
      futureMonths: monthsLeftInTaxYear(month) - 1,
      history: h,
    });
    tds.push(t.tds);
    h.salaryPaid += monthlyPay[i];
    h.tdsPaid += t.tds;
  });
  return tds;
};

describe('year-end true-up', () => {
  test('a steady ₹1.5 lakh a month: the 12 deductions add up to the year\'s tax exactly (₹1,50,800)', () => {
    const tds = runYear(Array(12).fill(R(150000)));
    expect(tds.reduce((s, x) => s + x, 0)).toBe(R(150800));
    expect(tds[11]).toBe(R(12566));
  });

  test('a raise in October: the later months catch up and the year still adds up', () => {
    // 6 × 1,00,000 + 6 × 2,00,000 = 18,00,000 → 17,25,000 taxable → 1,50,800
    const pay = [...Array(6).fill(R(100000)), ...Array(6).fill(R(200000))];
    const tds = runYear(pay);
    expect(tds.reduce((s, x) => s + x, 0)).toBe(R(150800));
    expect(tds[0]).toBe(0); // 12 lakh projected in April: under the rebate
  });

  // A small deterministic random generator, so a failure always reproduces.
  const mulberry32 = (seed) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  test('500 random years with pay that never falls: total TDS = tax on the actual year, to the rupee', () => {
    const rnd = mulberry32(20261102);
    for (let n = 0; n < 500; n += 1) {
      let monthly = R(Math.round(10000 + rnd() * 600000));
      const pay = [];
      for (let i = 0; i < 12; i += 1) {
        if (rnd() < 0.15) monthly += R(Math.round(rnd() * 100000));
        pay.push(monthly);
      }
      const old = rnd() < 0.3;
      const profile = old ? profileWith({ regime: 'old', chapter8_deductions: Math.round(rnd() * 150000) }) : NEW;
      const tds = runYear(pay, profile);
      const year = pay.reduce((s, x) => s + x, 0);
      const regime = old ? OLD_REGIME : NEW_REGIME;
      const taxable = year - Math.min(regime.standardDeduction, year) - (old ? profile.chapter8_deductions : 0);
      const expected = annualTax(Math.max(0, taxable), regime).total;
      expect(tds.every((x) => x >= 0 && x % 100 === 0)).toBe(true);
      expect(tds.reduce((s, x) => s + x, 0)).toBe(expected);
    }
  });
});


describe('leaving month and last-month rounding (independent review, 3 Nov)', () => {
  test('a known last working day: the leaving month is projected only in part, so nothing is over-deducted', () => {
    // ₹2L a month from April, leaving 10 Jan 2027: the year is 9 × 2L + 2L × 10/31 (64,516.13) = 18,64,516
    // → 17,89,516 → ₹10: 17,89,520 → 1,20,000 + 20% × 1,89,520 (37,904) = 1,57,904 + cess 6,316.16 → 1,64,220
    const h = history();
    const tds = [];
    const months = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1];
    months.forEach((month) => {
      const year = month >= 4 ? 2026 : 2027;
      const thisMonth = month === 1 ? R(64516) : R(200000);
      const t = projectMonthlyTds({
        month, year, profile: NEW, thisMonth, futureMonthly: R(200000),
        futureMonths: futureMonthsFor(month, year, '2027-01-10'), lastWorkingDay: '2027-01-10', history: h,
      });
      tds.push(t.tds);
      h.salaryPaid += thisMonth;
      h.tdsPaid += t.tds;
    });
    expect(tds[0]).toBe(R(16422)); // 1,64,220 ÷ 10
    expect(tds.reduce((s, x) => s + x, 0)).toBe(R(164220));
  });

  test('the last month rounds to the rupee even when TDS from elsewhere has paise', () => {
    // March: 22L paid here with 2,50,000 deducted, a previous employer's 1L with 1,234.50; March 2L
    // 25L − 75,000 = 24,25,000 → 3,07,500 + cess 12,300 = 3,19,800 − 2,51,234.50 = 68,565.50 → 68,566
    const t = projectMonthlyTds({
      month: 3,
      year: 2027,
      profile: profileWith({ previous_employer_income: 100000, previous_employer_tds: 1234.5 }),
      thisMonth: R(200000),
      futureMonthly: R(200000),
      futureMonths: 0,
      history: history({ salaryPaid: R(2200000), tdsPaid: R(250000) }),
    });
    expect(t.tds).toBe(R(68566));
    expect(t.worksheet.tds).toBe(R(68566));
  });
});

test('difference method: never more TDS than the year still owes (second review, 3 Nov)', () => {
  // January 2027: ₹9L paid (Apr–Dec) with ₹1,20,000 already deducted; regular year 12L → 11.25L taxable → nil (rebate).
  // A ₹2L bonus: the year's tax becomes 81,900 — less than already deducted, so nothing more is due.
  const tdsMod = require('../../src/payroll/tds');
  const r = tdsMod.projectMonthlyTds({
    month: 1,
    year: 2027,
    thisMonth: 100000_00,
    oneTime: 200000_00,
    futureMonthly: 100000_00,
    futureMonths: 2,
    history: { salaryPaid: 900000_00, tdsPaid: 120000_00, ptPaid: 0, earlierDrafts: [] },
  });
  expect(r.worksheet).toMatchObject({ annual_tax: 81900_00, one_time_tax: 81900_00, remaining: 0 });
  expect(r.tds).toBe(0);
});
