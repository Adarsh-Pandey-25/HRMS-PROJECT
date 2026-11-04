/**
 * Gratuity on leaving — hand-calculated: 15/26 × last monthly Basic + DA × years.
 */
const { serviceLength, computeGratuity } = require('../../src/payroll/gratuity');

const R = (rupees) => Math.round(rupees * 100);

describe('years of service', () => {
  test('whole years, and whether the part year is more than six months', () => {
    expect(serviceLength('2020-04-01', '2025-03-31')).toMatchObject({ years: 5, days: 0, moreThanSixMonths: false });
    expect(serviceLength('2020-04-01', '2025-09-30')).toMatchObject({ years: 5, moreThanSixMonths: false }); // exactly 6 months
    expect(serviceLength('2020-04-01', '2025-10-01')).toMatchObject({ years: 5, moreThanSixMonths: true }); // 6 months and a day
    expect(serviceLength('2021-06-15', '2026-06-13')).toMatchObject({ years: 4 }); // a day short of 5 years
    expect(serviceLength('2026-01-10', '2025-01-10')).toBe(null);
  });
});

describe('gratuity', () => {
  test('5 years exactly on ₹40,000 Basic + DA: 15/26 × 40,000 × 5 = 1,15,384.62 → 1,15,385', () => {
    const g = computeGratuity({ joinedOn: '2020-04-01', lastWorkingDay: '2025-03-31', monthlyWages: R(40000) });
    expect(g).toMatchObject({ eligible: true, years: 5, countedYears: 5, amount: R(115385), capped: false });
  });

  test('a part year of more than six months counts as a full year: 7 years 7 months → 8 years', () => {
    // 15/26 × 30,000 × 8 = 1,38,461.54 → 1,38,462
    const g = computeGratuity({ joinedOn: '2018-04-01', lastWorkingDay: '2025-10-31', monthlyWages: R(30000) });
    expect(g).toMatchObject({ years: 7, countedYears: 8, amount: R(138462) });
    // 7 years 5 months → 7 years: 15/26 × 30,000 × 7 = 1,21,153.85 → 1,21,154
    expect(computeGratuity({ joinedOn: '2018-04-01', lastWorkingDay: '2025-08-31', monthlyWages: R(30000) }).amount).toBe(R(121154));
  });

  test('under 5 years: nothing, with the reason', () => {
    const g = computeGratuity({ joinedOn: '2021-06-15', lastWorkingDay: '2026-06-13', monthlyWages: R(50000) });
    expect(g).toMatchObject({ eligible: false, amount: 0 });
    expect(g.reason).toMatch(/Less than 5 years/);
  });

  test('the ₹20 lakh ceiling: 30 years on ₹2 lakh would be 34,61,538 → 20,00,000', () => {
    const g = computeGratuity({ joinedOn: '1995-04-01', lastWorkingDay: '2025-03-31', monthlyWages: R(200000) });
    expect(g).toMatchObject({ capped: true, amount: R(2000000) });
  });

  test('fixed-term: after 1 year, the part year pro rata', () => {
    // 1 year and 73 days (1.2 years) on ₹26,000: 15/26 × 26,000 × (365 + 73)/365 = 15,000 × 1.2 = 18,000
    const g = computeGratuity({ joinedOn: '2025-01-01', lastWorkingDay: '2026-03-14', monthlyWages: R(26000), fixedTerm: true });
    expect(g).toMatchObject({ eligible: true, years: 1, extraDays: 73, amount: R(18000) });
    expect(computeGratuity({ joinedOn: '2025-06-01', lastWorkingDay: '2026-03-14', monthlyWages: R(26000), fixedTerm: true }).eligible).toBe(false);
  });
});
