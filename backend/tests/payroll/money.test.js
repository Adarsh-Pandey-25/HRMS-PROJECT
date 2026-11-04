const {
  toPaise, toRupees, mulDiv, roundRupees, rateRupees, ratePaise, percentRate,
} = require('../../src/payroll/money');

describe('money', () => {
  test('toPaise is exact for two-decimal rupee amounts', () => {
    expect(toPaise(0.1)).toBe(10);
    expect(toPaise(0.29)).toBe(29);
    expect(toPaise(1.005)).toBe(100); // 1.005 is really 1.00499… as a float; DB amounts never have 3 decimals
    expect(toPaise(8363.64)).toBe(836364);
    expect(toPaise('22000')).toBe(2200000);
    expect(toPaise(null)).toBe(0);
    expect(toPaise('abc')).toBe(0);
    expect(toRupees(836364)).toBe(8363.64);
  });

  test('mulDiv rounds the exact value', () => {
    expect(mulDiv(5, 1, 2)).toBe(3); // 2.5 → 3 (half away from zero)
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(mulDiv(7, 1, 3)).toBe(2); // 2.33
    expect(mulDiv(8, 1, 3)).toBe(3); // 2.67
    expect(mulDiv(7, 1, 3, 'up')).toBe(3);
    expect(mulDiv(-7, 1, 3, 'up')).toBe(-2);
    expect(mulDiv(8, 1, 3, 'down')).toBe(2);
    expect(mulDiv(-8, 1, 3, 'down')).toBe(-3);
    expect(mulDiv(6, 1, 3, 'up')).toBe(2); // exact: no rounding
    // A value a float would land on the wrong side of: 0.495 × 1 (exact) → 0
    expect(mulDiv(495, 1, 1000)).toBe(0);
    expect(mulDiv(500, 1, 1000)).toBe(1);
    expect(() => mulDiv(1.5, 1, 2)).toThrow();
    expect(() => mulDiv(1, 1, 0)).toThrow();
  });

  test('rupee rounding', () => {
    expect(roundRupees(836364)).toBe(836400); // 8,363.64 → 8,364
    expect(roundRupees(836350)).toBe(836400); // 8,363.50 → 8,364
    expect(roundRupees(836349)).toBe(836300);
    expect(roundRupees(12886, 'up')).toBe(12900); // 128.86 → 129
    expect(roundRupees(12800, 'up')).toBe(12800);
  });

  test('rates', () => {
    expect(rateRupees(2500000, { num: 833, den: 10000 })).toBe(208300); // 8.33% of 25,000 = 2,082.50 → 2,083
    expect(rateRupees(2000000, { num: 12, den: 100 })).toBe(240000);
    expect(rateRupees(1718100, { num: 75, den: 10000 }, 'up')).toBe(12900); // 128.8575 → 129
    expect(ratePaise(1718100, { num: 75, den: 10000 })).toBe(12886);
    expect(percentRate('12')).toEqual({ num: 12, den: 100 });
    expect(percentRate(8.33)).toEqual({ num: 833, den: 10000 });
    expect(percentRate('0.75')).toEqual({ num: 75, den: 10000 });
    expect(() => percentRate('-1')).toThrow();
    expect(() => percentRate('1e3')).toThrow();
  });
});
