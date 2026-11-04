/**
 * Golden tests for salary income tax. Expected rupee figures were worked out
 * by hand first; the working is in the comments.
 */
const {
  annualTax, monthlyTds, slabTax, roundToTenRupees,
} = require('../../src/payroll/incomeTax');
const {
  NEW_REGIME, OLD_REGIME, taxRulesFor, taxYearOf, monthsLeftInTaxYear,
} = require('../../src/payroll/taxRules');

const R = (rupees) => Math.round(rupees * 100);

describe('tax years', () => {
  test('April–March, and the months left including this one', () => {
    expect(taxYearOf(10, 2026)).toBe('2026-27');
    expect(taxYearOf(3, 2027)).toBe('2026-27');
    expect(taxYearOf(4, 2027)).toBe('2027-28');
    expect(taxYearOf(1, 2026)).toBe('2025-26');
    expect([4, 10, 12, 1, 3].map(monthsLeftInTaxYear)).toEqual([12, 6, 4, 3, 1]);
    expect(taxRulesFor(10, 2026).id).toBe('IT-2026-27');
  });
});

describe('new regime, tax year 2026-27', () => {
  const total = (rupees) => annualTax(R(rupees), NEW_REGIME).total / 100;

  test('slab tax', () => {
    // 0–4L nil, 4–8L 5% = 20,000, 8–12L 10% = 40,000, 12–16L 15% = 60,000
    expect(slabTax(R(1600000), NEW_REGIME.slabs)).toBe(R(120000));
  });

  test("the report's ₹24 lakh salary: taxable 23,25,000 → 2,81,250 + 4% cess = 2,92,500", () => {
    const t = annualTax(R(2325000), NEW_REGIME);
    // 20,000 + 40,000 + 60,000 + 80,000 + 25% × 3,25,000 (81,250) = 2,81,250
    expect(t.slabTax).toBe(R(281250));
    expect(t.cess).toBe(R(11250));
    expect(t.total).toBe(R(292500));
  });

  test('no tax up to ₹12 lakh taxable (rebate up to ₹60,000)', () => {
    expect(total(400000)).toBe(0);
    expect(total(401364)).toBe(0); // the report's Example 1: 5% × 1,364 = 68 → rebated
    expect(total(1200000)).toBe(0); // 60,000 → rebated in full
  });

  test('marginal relief just above ₹12 lakh: tax never more than the income above 12 lakh', () => {
    // 12,10,000: slab 61,500; relief caps it at 10,000; + 4% cess 400 = 10,400
    expect(total(1210000)).toBe(10400);
    // 12,70,000: slab 70,500; cap 70,000 → + cess 2,800 = 72,800
    expect(total(1270000)).toBe(72800);
    // 12,75,000: slab 71,250 is below the cap of 75,000 → + cess 2,850 = 74,100
    expect(total(1275000)).toBe(74100);
  });

  test('surcharge 10% above ₹50 lakh, with marginal relief right above it', () => {
    // 60 lakh: slab 13,80,000; surcharge 1,38,000 (no relief needed); cess 4% of 15,18,000 = 60,720 → 15,78,720
    const t60 = annualTax(R(6000000), NEW_REGIME);
    expect(t60.slabTax).toBe(R(1380000));
    expect(t60.surcharge).toBe(R(138000));
    expect(t60.total).toBe(R(1578720));
    // 50,10,000: slab 10,83,000; full surcharge would be 1,08,300, but tax + surcharge may not pass
    // the tax at 50 lakh (10,80,000) + 10,000 = 10,90,000 → surcharge 7,000; cess 43,600 → 11,33,600
    const t = annualTax(R(5010000), NEW_REGIME);
    expect(t.surcharge).toBe(R(7000));
    expect(t.total).toBe(R(1133600));
  });

  test('exactly ₹50 lakh: no surcharge', () => {
    expect(annualTax(R(5000000), NEW_REGIME).surcharge).toBe(0);
  });
});

describe('old regime', () => {
  const total = (rupees, ageBand = null) => annualTax(R(rupees), OLD_REGIME, { ageBand }).total / 100;
  test('rebate up to ₹5 lakh, none above (no marginal relief)', () => {
    expect(total(500000)).toBe(0); // 5% × 2,50,000 = 12,500 → rebated
    // 5,10,000: 12,500 + 20% × 10,000 = 14,500 + cess 580 = 15,080
    expect(total(510000)).toBe(15080);
    // 10 lakh: 12,500 + 1,00,000 = 1,12,500 + cess 4,500 = 1,17,000
    expect(total(1000000)).toBe(117000);
  });
  test('60–79: nil to ₹3 lakh; 80 and over: nil to ₹5 lakh', () => {
    // 6 lakh: under 60 12,500 + 20,000 = 32,500 + 1,300 = 33,800; 60–79 10,000 + 20,000 = 30,000 + 1,200 = 31,200;
    // 80+ 20,000 + 800 = 20,800
    expect(total(600000)).toBe(33800);
    expect(total(600000, 'senior')).toBe(31200);
    expect(total(600000, 'super_senior')).toBe(20800);
    expect(total(500000, 'senior')).toBe(0); // 10,000 → rebated
    expect(total(500000, 'super_senior')).toBe(0);
    // The new regime ignores age.
    expect(annualTax(R(600000), NEW_REGIME, { ageBand: 'super_senior' }).total).toBe(0);
  });
});

describe('rounding to ₹10 (Income-tax Act 2025 s.516, as s.288A/288B before)', () => {
  test('paise dropped, then a last digit of 5 or more rounds up', () => {
    expect(roundToTenRupees(R(95700.8))).toBe(R(95700));
    expect(roundToTenRupees(R(300887.6))).toBe(R(300890));
    expect(roundToTenRupees(R(2357258))).toBe(R(2357260));
    expect(roundToTenRupees(R(15))).toBe(R(20));
    expect(roundToTenRupees(R(14.99))).toBe(R(10));
    expect(roundToTenRupees(0)).toBe(0);
  });
  test('taxable income and the year\'s tax are both rounded', () => {
    // 23,57,258 → 23,57,260: 2,00,000 + 25% × 3,57,260 (89,315) = 2,89,315 + cess 11,572.60 = 3,00,887.60 → 3,00,890
    const t = annualTax(R(2357258), NEW_REGIME);
    expect(t.taxableIncome).toBe(R(2357260));
    expect(t.total).toBe(R(300890));
  });
});

describe('monthly TDS', () => {
  const rules = taxRulesFor(10, 2026);

  test("the report's Example 2: ₹2 lakh a month, October → ₹24,375", () => {
    // Paid April–September 12,00,000 with 6 × 24,375 = 1,46,250 deducted; October 2,00,000; 5 more months
    // projected 24,00,000 − 75,000 = 23,25,000 → tax 2,92,500 − 1,46,250 = 1,46,250 ÷ 6 = 24,375
    const t = monthlyTds({
      rules, regime: 'new', monthsLeft: 6, salaryPaidBefore: R(1200000), thisMonth: R(200000), futureMonthly: R(200000), tdsBefore: R(146250),
    });
    expect(t.annualTax).toBe(R(292500));
    expect(t.tds).toBe(R(24375));
  });

  test('from April the same salary also gives ₹24,375 (2,92,500 ÷ 12)', () => {
    expect(monthlyTds({
      rules, regime: 'new', monthsLeft: 12, salaryPaidBefore: 0, thisMonth: R(200000), futureMonthly: R(200000), tdsBefore: 0,
    }).tds).toBe(R(24375));
  });

  test("the report's Example 1: ₹40,000 a month, 2 days absent in October → nil", () => {
    // 6 × 40,000 + 36,364 + 5 × 40,000 = 4,76,364 − 75,000 = 4,01,364 → rebated
    expect(monthlyTds({
      rules, regime: 'new', monthsLeft: 6, salaryPaidBefore: R(240000), thisMonth: R(36364), futureMonthly: R(40000), tdsBefore: 0,
    }).tds).toBe(0);
  });

  test('March settles the exact remainder', () => {
    expect(monthlyTds({
      rules, regime: 'new', monthsLeft: 1, salaryPaidBefore: R(2200000), thisMonth: R(200000), futureMonthly: R(200000), tdsBefore: R(11 * 24375),
    }).tds).toBe(R(24375));
  });

  test('a joiner in October with ₹6 lakh from a previous employer: counted, still under the rebate', () => {
    // 6,00,000 + 1,00,000 × 6 = 12,00,000 − 75,000 = 11,25,000 → 52,500 → rebated → 0
    const t = monthlyTds({
      rules, regime: 'new', monthsLeft: 6, salaryPaidBefore: 0, thisMonth: R(100000), futureMonthly: R(100000), tdsBefore: 0, previousEmployerIncome: R(600000),
    });
    expect(t.projectedSalary).toBe(R(1200000));
    expect(t.tds).toBe(0);
  });

  test('old regime with declared deductions: ₹1 lakh a month, ₹2.5 lakh declared', () => {
    // 12,00,000 − 50,000 − 2,50,000 = 9,00,000 → 12,500 + 20% × 4,00,000 = 92,500 + cess 3,700 = 96,200 ÷ 12 = 8,016.67 → 8,017
    const t = monthlyTds({
      rules, regime: 'old', monthsLeft: 12, salaryPaidBefore: 0, thisMonth: R(100000), futureMonthly: R(100000), tdsBefore: 0, deductions: R(250000),
    });
    expect(t.taxableIncome).toBe(R(900000));
    expect(t.annualTax).toBe(R(96200));
    expect(t.tds).toBe(R(8017));
  });

  test('declared deductions are ignored under the new regime', () => {
    const t = monthlyTds({
      rules, regime: 'new', monthsLeft: 12, salaryPaidBefore: 0, thisMonth: R(200000), futureMonthly: R(200000), tdsBefore: 0, deductions: R(250000),
    });
    expect(t.deductions).toBe(0);
    expect(t.tds).toBe(R(24375));
  });

  test('more already deducted than due → nothing this month (never negative)', () => {
    expect(monthlyTds({
      rules, regime: 'new', monthsLeft: 6, salaryPaidBefore: R(240000), thisMonth: R(40000), futureMonthly: R(40000), tdsBefore: R(5000),
    }).tds).toBe(0);
  });
});
