/**
 * Statutory bonus and leave encashment (report §3.4) — pure, in paise.
 *
 * Statutory bonus: a percentage the company chooses between 8.33% and 20%
 * (by its allocable surplus), for employees whose wages (Basic + DA) are
 * ₹21,000 a month or less, worked out on each month's wages up to the
 * calculation ceiling — ₹7,000 or the minimum wage, whichever is higher.
 * The minimum wage depends on the state and the job, so the company enters it.
 *
 * Leave encashment: encashable days × a day's pay, where a day's pay is the
 * company's base (Basic + DA, or gross) ÷ its day divisor (26 or 30, say).
 */
const { mulDiv } = require('./money');

const BONUS_RULES = [{
  id: 'BONUS-PoBA',
  from: '2015-04-01',
  to: null,
  eligibilityCeiling: 21000_00, // wages a month
  calculationFloor: 7000_00, // or the minimum wage, whichever is higher
  minPercent: { num: 833, den: 10000 },
  maxPercent: { num: 20, den: 100 },
  source: 'Payment of Bonus Act / Code on Wages (per the 27 Oct 2026 report)',
  status: 'confirm',
}];

/** '8.33' → { num: 833, den: 10000 }; refuses anything outside 8.33%–20%. */
const bonusPercent = (percent, rule = BONUS_RULES[0]) => {
  const s = String(percent ?? '').trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const rate = { num: Number(whole) * 100 + Number(frac.padEnd(2, '0')), den: 10000 };
  const atLeast = rate.num * rule.minPercent.den >= rule.minPercent.num * rate.den;
  const atMost = rate.num * rule.maxPercent.den <= rule.maxPercent.num * rate.den;
  return atLeast && atMost ? rate : null;
};

/**
 * @param {object} p
 *   months       [{ wages }] — each month's earned Basic + DA in the accounting year (paise)
 *   percent      '8.33' … '20'
 *   minimumWage  the applicable minimum wage a month (paise), if higher than ₹7,000
 * @returns {{ eligible, bonus, ceiling, bonusWages, reason }}
 */
const computeStatutoryBonus = ({
  months = [], percent, minimumWage = 0, rule = BONUS_RULES[0],
}) => {
  const rate = bonusPercent(percent, rule);
  if (!rate) return { eligible: false, bonus: 0, reason: 'The bonus percentage must be between 8.33 and 20' };
  const paid = months.filter((m) => Number(m?.wages) > 0);
  if (!paid.length) return { eligible: false, bonus: 0, reason: 'No wages in the year' };
  if (paid.some((m) => m.wages > rule.eligibilityCeiling)) {
    return { eligible: false, bonus: 0, reason: 'Wages above ₹21,000 a month in the year' };
  }
  const ceiling = Math.max(rule.calculationFloor, Math.round(Number(minimumWage) || 0));
  const bonusWages = paid.reduce((s, m) => s + Math.min(m.wages, ceiling), 0);
  return {
    eligible: true,
    ceiling,
    bonusWages,
    bonus: mulDiv(bonusWages, rate.num, rate.den * 100) * 100,
    rule: rule.id,
  };
};

/**
 * Leave encashment: `days` (half days allowed) × monthlyBase ÷ divisor, to the rupee.
 */
const computeEncashment = ({ days, monthlyBase, divisor }) => {
  const halves = Math.round(Number(days) * 2);
  const d = Math.round(Number(divisor));
  if (!(halves > 0) || !(d > 0) || !(monthlyBase > 0)) return 0;
  return mulDiv(Math.round(monthlyBase), halves, d * 2 * 100) * 100;
};

module.exports = {
  BONUS_RULES, bonusPercent, computeStatutoryBonus, computeEncashment,
};
