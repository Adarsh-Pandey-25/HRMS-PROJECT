/**
 * Statutory bonus and leave encashment — hand-calculated.
 */
const { bonusPercent, computeStatutoryBonus, computeEncashment } = require('../../src/payroll/bonusEncashment');

const R = (rupees) => Math.round(rupees * 100);
const year = (wages) => Array.from({ length: 12 }, () => ({ wages: R(wages) }));

describe('statutory bonus', () => {
  test('the percentage must be 8.33–20', () => {
    expect(bonusPercent('8.33')).toEqual({ num: 833, den: 10000 });
    expect(bonusPercent('20')).toEqual({ num: 2000, den: 10000 });
    expect(bonusPercent('8.32')).toBe(null);
    expect(bonusPercent('20.01')).toBe(null);
    expect(bonusPercent('abc')).toBe(null);
  });

  test('₹15,000 Basic + DA all year at 8.33%, minimum wage below ₹7,000: on ₹7,000 a month', () => {
    // 12 × 7,000 = 84,000 × 8.33% = 6,997.20 → 6,997
    const b = computeStatutoryBonus({ months: year(15000), percent: '8.33' });
    expect(b).toMatchObject({ eligible: true, ceiling: R(7000), bonusWages: R(84000), bonus: R(6997) });
  });

  test('a minimum wage above ₹7,000 raises the ceiling: ₹12,500 minimum wage, 20%', () => {
    // 12 × min(15,000, 12,500) = 1,50,000 × 20% = 30,000
    expect(computeStatutoryBonus({ months: year(15000), percent: '20', minimumWage: R(12500) }).bonus).toBe(R(30000));
    // Wages under the ceiling count as they are: ₹6,000 a month → 72,000 × 8.33% = 5,997.60 → 5,998
    expect(computeStatutoryBonus({ months: year(6000), percent: '8.33' }).bonus).toBe(R(5998));
  });

  test('a part year counts only the months paid; wages above ₹21,000 make it not due', () => {
    // 4 months × 7,000 = 28,000 × 8.33% = 2,332.40 → 2,332
    expect(computeStatutoryBonus({ months: [...year(0).slice(0, 8), ...year(10000).slice(0, 4)], percent: '8.33' }).bonus).toBe(R(2332));
    const high = computeStatutoryBonus({ months: year(22000), percent: '8.33' });
    expect(high).toMatchObject({ eligible: false, bonus: 0 });
  });
});

describe('leave encashment', () => {
  test('days × monthly base ÷ divisor, to the rupee', () => {
    // 10 days × 30,000 ÷ 26 = 11,538.46 → 11,538
    expect(computeEncashment({ days: 10, monthlyBase: R(30000), divisor: 26 })).toBe(R(11538));
    // 7.5 days × 30,000 ÷ 30 = 7,500
    expect(computeEncashment({ days: 7.5, monthlyBase: R(30000), divisor: 30 })).toBe(R(7500));
    expect(computeEncashment({ days: 0, monthlyBase: R(30000), divisor: 30 })).toBe(0);
  });
});
