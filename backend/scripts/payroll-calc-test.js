/**
 * Pure payroll math test — mirrors backend calculateContractPayslip
 * Run: node backend/scripts/payroll-calc-test.js
 */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function calculate({
  basic, hra = 0, da = 0, special = 0,
  workingDays = 22,
  absent = 0,
  halfDay = 0,
  pfRate = 0.12,
  ptAmount = 200,
  tdsPercent = 8,
  esiEmployeePercent = 0.75,
  esiThreshold = 21000,
  customOptions = [],
}) {
  const earnings = [
    { name: 'Basic', amount: round2(basic) },
    { name: 'HRA', amount: round2(hra) },
  ];
  if (da > 0) earnings.push({ name: 'DA', amount: round2(da) });
  if (special > 0) earnings.push({ name: 'Special Allowance', amount: round2(special) });

  let gross = round2(earnings.reduce((s, e) => s + e.amount, 0));

  // Custom allowances first so TDS/ESI/LOP use final gross
  const pendingDed = [];
  for (const opt of customOptions) {
    const amount = opt.valueType === 'percent'
      ? round2((opt.base === 'gross' ? gross : basic) * (opt.value / 100))
      : round2(opt.value);
    if (opt.kind === 'allowance') {
      earnings.push({ name: opt.name, amount });
      gross = round2(gross + amount);
    } else {
      pendingDed.push({ name: opt.name, amount });
    }
  }

  const unpaid = round2(Math.max(0, absent + halfDay * 0.5));
  const lop = round2((gross / Math.max(1, workingDays)) * unpaid);
  const pf = round2(basic * pfRate);
  const pt = round2(ptAmount);
  const tds = round2(gross * (tdsPercent / 100));
  const esi = gross > 0 && gross <= esiThreshold && esiEmployeePercent > 0
    ? round2(gross * (esiEmployeePercent / 100))
    : 0;

  const deductions = [];
  if (lop > 0) deductions.push({ name: 'LOP', amount: lop });
  if (pf > 0) deductions.push({ name: 'PF', amount: pf });
  if (pt > 0) deductions.push({ name: 'Professional Tax', amount: pt });
  if (tds > 0) deductions.push({ name: 'TDS', amount: tds });
  if (esi > 0) deductions.push({ name: 'ESI', amount: esi });
  for (const d of pendingDed) deductions.push(d);

  const totalDed = round2(deductions.reduce((s, d) => s + d.amount, 0));
  const net = round2(Math.max(0, gross - totalDed));
  return { earnings, deductions, gross, unpaid, lop, pf, pt, tds, esi, totalDed, net };
}

function assertEq(label, actual, expected) {
  const ok = Math.abs(Number(actual) - Number(expected)) < 0.011;
  if (!ok) {
    console.error(`FAIL ${label}: got ${actual}, expected ${expected}`);
    process.exitCode = 1;
  } else {
    console.log(`OK   ${label}: ${actual}`);
  }
}

console.log('\n=== Case 1: Full month present (basic 1,00,000) ===');
{
  const r = calculate({
    basic: 100000, hra: 0, da: 0, special: 0,
    workingDays: 22, absent: 0, halfDay: 0,
    pfRate: 0.12, ptAmount: 200, tdsPercent: 8,
    esiThreshold: 21000,
  });
  // Gross 100000 → PF 12000, PT 200, TDS 8000 → net 79800
  assertEq('gross', r.gross, 100000);
  assertEq('pf', r.pf, 12000);
  assertEq('pt', r.pt, 200);
  assertEq('tds', r.tds, 8000);
  assertEq('esi', r.esi, 0);
  assertEq('lop', r.lop, 0);
  assertEq('net', r.net, 79800);
}

console.log('\n=== Case 2: With HRA/DA/Special ===');
{
  const r = calculate({
    basic: 50000, hra: 20000, da: 5000, special: 10000,
    workingDays: 22, absent: 0,
    pfRate: 0.12, ptAmount: 200, tdsPercent: 8,
  });
  // Gross 85000, PF 6000, PT 200, TDS 6800 → net 72000
  assertEq('gross', r.gross, 85000);
  assertEq('pf', r.pf, 6000);
  assertEq('tds', r.tds, 6800);
  assertEq('net', r.net, 72000);
}

console.log('\n=== Case 3: 2 days absent LOP ===');
{
  const r = calculate({
    basic: 44000, hra: 0,
    workingDays: 22, absent: 2,
    pfRate: 0.12, ptAmount: 200, tdsPercent: 0,
  });
  // LOP = 44000/22*2 = 4000, PF 5280, PT 200 → net 34520
  assertEq('lop', r.lop, 4000);
  assertEq('pf', r.pf, 5280);
  assertEq('net', r.net, 34520);
}

console.log('\n=== Case 4: ESI applies (gross ≤ 21k) ===');
{
  const r = calculate({
    basic: 15000, hra: 5000,
    workingDays: 22, absent: 0,
    pfRate: 0.12, ptAmount: 0, tdsPercent: 0,
    esiEmployeePercent: 0.75, esiThreshold: 21000,
  });
  // Gross 20000, PF 1800, ESI 150 → net 18050
  assertEq('gross', r.gross, 20000);
  assertEq('esi', r.esi, 150);
  assertEq('pf', r.pf, 1800);
  assertEq('net', r.net, 18050);
}

console.log('\n=== Case 5: Custom deduction ₹500 ===');
{
  const r = calculate({
    basic: 50000, hra: 0,
    workingDays: 22, absent: 0,
    pfRate: 0.12, ptAmount: 200, tdsPercent: 0,
    customOptions: [{ name: 'Insurance', kind: 'deduction', valueType: 'fixed', value: 500 }],
  });
  // Gross 50000, PF 6000, PT 200, Ins 500 → net 43300
  assertEq('net', r.net, 43300);
}

console.log('\n=== Case 6: Half-day LOP ===');
{
  const r = calculate({
    basic: 22000, hra: 0,
    workingDays: 22, absent: 0, halfDay: 1,
    pfRate: 0, ptAmount: 0, tdsPercent: 0,
  });
  // LOP = 22000/22 * 0.5 = 500
  assertEq('lop', r.lop, 500);
  assertEq('net', r.net, 21500);
}

console.log('\n=== Case 7: Custom allowance raises TDS ===');
{
  const r = calculate({
    basic: 50000, hra: 0,
    workingDays: 22, absent: 0,
    pfRate: 0.12, ptAmount: 0, tdsPercent: 8,
    customOptions: [{ name: 'Bonus', kind: 'allowance', valueType: 'fixed', value: 10000 }],
  });
  // Gross 60000, PF 6000, TDS 4800 → net 49200
  assertEq('gross', r.gross, 60000);
  assertEq('tds', r.tds, 4800);
  assertEq('net', r.net, 49200);
}

if (process.exitCode) {
  console.log('\nSome payroll calc tests FAILED.\n');
} else {
  console.log('\nAll payroll calc tests PASSED.\n');
}
