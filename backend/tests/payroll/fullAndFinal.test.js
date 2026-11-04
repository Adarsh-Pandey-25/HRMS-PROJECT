/**
 * Full and final settlement items (pure). Every figure worked out by hand first.
 */
const { computeFullAndFinal } = require('../../src/payroll/fullAndFinal');

const R = (rupees) => Math.round(rupees * 100);
const item = (out, code) => out.items.find((i) => i.code === code);

const leaver = {
  joinedOn: '2019-06-01',
  lastWorkingDay: '2026-10-31',
  monthlyBasicDa: R(22000),
  monthlyWages: R(22000),
  monthlyGross: R(40000),
};

test('gratuity: 7 years 5 months → 7 years; 22,000 × 15 ÷ 26 × 7 = 88,846.15 → 88,846', () => {
  const out = computeFullAndFinal(leaver);
  expect(item(out, 'GRATUITY')).toMatchObject({ kind: 'earning', amount: R(88846), working: { years: 7, divisor: 26, days_per_year: 15 } });
});

test('gratuity with the company dividing by 30: 22,000 × 15 ÷ 30 × 7 = 77,000; under 5 years nothing', () => {
  expect(item(computeFullAndFinal({ ...leaver, calc: { gratuity: { divisor: 30 } } }), 'GRATUITY').amount).toBe(R(77000));
  const short = computeFullAndFinal({ ...leaver, joinedOn: '2022-01-10' });
  expect(item(short, 'GRATUITY')).toBeUndefined();
  expect(short.notes[0]).toMatch(/No gratuity: Less than 5 years/);
});

test('leave encashment: 10.5 days × 22,000 ÷ 26 = 8,884.62 → 8,885; on gross ÷ 30: 40,000 × 10.5 ÷ 30 = 14,000', () => {
  expect(item(computeFullAndFinal({ ...leaver, leaveDays: 10.5 }), 'LEAVE_ENCASHMENT').amount).toBe(R(8885));
  const gross = computeFullAndFinal({ ...leaver, leaveDays: 10.5, calc: { encashment: { base: 'gross', divisor: 30 } } });
  expect(item(gross, 'LEAVE_ENCASHMENT').amount).toBe(R(14000));
});

test('notice: 60 days needed, 30 served → recover 40,000 × 30 ÷ 30 = 40,000; paid in lieu instead; waived: nothing', () => {
  const notice = { requiredDays: 60, servedDays: 30, base: 'gross', divisor: 30 };
  expect(item(computeFullAndFinal({ ...leaver, notice: { ...notice, action: 'recover' } }), 'NOTICE_RECOVERY'))
    .toMatchObject({ kind: 'deduction', amount: R(40000) });
  expect(item(computeFullAndFinal({ ...leaver, notice: { ...notice, action: 'pay' } }), 'NOTICE_PAY'))
    .toMatchObject({ kind: 'earning', amount: R(40000) });
  expect(computeFullAndFinal({ ...leaver, notice: { ...notice, action: 'waive' } }).items.map((i) => i.code)).toEqual(['GRATUITY']);
  // 7 days short on Basic + DA ÷ 26: 22,000 × 7 ÷ 26 = 5,923.08 → 5,923
  expect(item(computeFullAndFinal({ ...leaver, notice: { requiredDays: 30, servedDays: 23, action: 'recover', base: 'basic_da', divisor: 26 } }), 'NOTICE_RECOVERY').amount)
    .toBe(R(5923));
});

test('statutory bonus for April–October on ₹15,000 wages: 7 × 7,000 × 8.33% = 4,081.70 → 4,082', () => {
  const months = Array.from({ length: 7 }, () => ({ wages: R(15000) }));
  const out = computeFullAndFinal({ ...leaver, bonusMonths: months });
  expect(item(out, 'BONUS')).toMatchObject({ amount: R(4082), working: { percent: 8.33, bonus_wages: R(49000) } });
  // Above the ₹21,000 limit: none, with the reason.
  const high = computeFullAndFinal({ ...leaver, bonusMonths: [{ wages: R(22000) }] });
  expect(item(high, 'BONUS')).toBeUndefined();
  expect(high.notes.some((n) => /No statutory bonus/.test(n))).toBe(true);
  // A company paying 25%: the statutory 20% here (7 × 7,000 × 20% = 9,800), the rest is ex-gratia.
  const generous = computeFullAndFinal({ ...leaver, bonusMonths: months, calc: { bonus: { percent: 25 } } });
  expect(item(generous, 'BONUS').amount).toBe(R(9800));
  expect(generous.notes).toContain('The bonus above 20% is ex-gratia: add it as one-time pay.');
});
