/**
 * Money for payroll, kept in whole paise (integers).
 *
 * Rupee amounts stored in the database have at most two decimals, so
 * toPaise is exact. Every division goes through BigInt, so a rounding
 * decision is made on the exact value, never on a floating-point
 * approximation (0.1 + 0.2 style errors can't move a payslip by a paisa).
 */

const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

const toRupees = (paise) => Number(paise || 0) / 100;

/**
 * round(a × num ÷ den) to an integer, exactly.
 *   half_up  nearest; an exact half goes away from zero
 *   up       towards +∞ (ceiling)
 *   down     towards −∞ (floor)
 */
const mulDiv = (a, num, den, mode = 'half_up') => {
  if (![a, num, den].every(Number.isSafeInteger) || den === 0) {
    throw new Error(`mulDiv needs safe integers and a non-zero divisor (got ${a}, ${num}, ${den})`);
  }
  let n = BigInt(a) * BigInt(num);
  let d = BigInt(den);
  if (d < 0n) { n = -n; d = -d; }
  const negative = n < 0n;
  const abs = negative ? -n : n;
  let q = abs / d;
  const r = abs % d;
  if (r !== 0n) {
    if (mode === 'half_up') {
      if (2n * r >= d) q += 1n;
    } else if (mode === 'up') {
      if (!negative) q += 1n;
    } else if (mode === 'down') {
      if (negative) q += 1n;
    } else {
      throw new Error(`Unknown rounding mode: ${mode}`);
    }
  }
  return Number(negative ? -q : q);
};

/** Paise rounded to whole rupees, still in paise. */
const roundRupees = (paise, mode = 'half_up') => mulDiv(paise, 1, 100, mode) * 100;

/** An amount × a rate { num, den }, rounded to whole rupees (in paise). */
const rateRupees = (paise, rate, mode = 'half_up') => mulDiv(paise, rate.num, rate.den * 100, mode) * 100;

/** An amount × a rate { num, den }, rounded to paise. */
const ratePaise = (paise, rate, mode = 'half_up') => mulDiv(paise, rate.num, rate.den, mode);

const sum = (list) => list.reduce((s, x) => s + x, 0);

/** "12.5" or 12.5 → { num: 125, den: 1000 } as a fraction of 1 (12.5% → 0.125). */
const percentRate = (percent) => {
  const s = String(percent ?? '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(s)) throw new Error(`Not a percentage: ${percent}`);
  const [whole, frac = ''] = s.split('.');
  const scale = 10 ** frac.length;
  return { num: Number(whole) * scale + Number(frac || 0), den: 100 * scale };
};

module.exports = {
  toPaise,
  toRupees,
  mulDiv,
  roundRupees,
  rateRupees,
  ratePaise,
  sum,
  percentRate,
};
