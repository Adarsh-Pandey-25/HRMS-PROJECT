/**
 * Gratuity on leaving (report §3.4) — pure, in paise.
 *
 *   gratuity = 15/26 × last monthly wages (Basic + DA) × years of service
 *
 * Due after 5 years of continuous service (fixed-term employees: 1 year,
 * pro rata — the `fixedTerm` flag), capped at ₹20 lakh. Years of service:
 * whole years, and a part year of more than six months counts as a full year
 * (the usual reading of the Payment of Gratuity Act; on the list for a CA to
 * confirm — docs/payroll-statutory-values.md). For a fixed-term employee the
 * part year counts pro rata instead (days ÷ 365).
 */
const { mulDiv } = require('./money');

const GRATUITY_RULES = [{
  id: 'GRATUITY-2026',
  from: '2025-11-21',
  to: null,
  minYears: 5,
  minYearsFixedTerm: 1,
  ceiling: 20_00_000_00, // ₹20 lakh
  factor: { num: 15, den: 26 },
  source: 'Payment of Gratuity Act / Code on Social Security (per the 27 Oct 2026 report)',
  status: 'confirm',
}];

const parseDay = (d) => {
  const s = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)), s };
};

/** Whole years and the days left over between joining and the last working day (inclusive). */
const serviceLength = (joinedOn, lastWorkingDay) => {
  const a = parseDay(joinedOn);
  const b = parseDay(lastWorkingDay);
  if (!a || !b || b.s < a.s) return null;
  // The day after the last working day closes the period.
  const end = new Date(Date.UTC(b.y, b.m - 1, b.d + 1));
  let years = end.getUTCFullYear() - a.y;
  const anniversary = (n) => new Date(Date.UTC(a.y + n, a.m - 1, a.d));
  if (anniversary(years) > end) years -= 1;
  const lastAnniversary = anniversary(years);
  const days = Math.round((end - lastAnniversary) / 86400000);
  // Months beyond the last anniversary, for the "more than six months" rule.
  let months = (end.getUTCFullYear() - lastAnniversary.getUTCFullYear()) * 12 + (end.getUTCMonth() - lastAnniversary.getUTCMonth());
  if (end.getUTCDate() < lastAnniversary.getUTCDate()) months -= 1;
  const moreThanSixMonths = months > 6 || (months === 6 && end.getUTCDate() > lastAnniversary.getUTCDate());
  return { years, days, moreThanSixMonths };
};

/**
 * @param {object} p
 *   joinedOn, lastWorkingDay  'YYYY-MM-DD'
 *   monthlyWages              last drawn Basic + DA a month (paise)
 *   fixedTerm                 a fixed-term employee (eligible after 1 year, part year pro rata)
 *   rule                      a GRATUITY_RULES entry (default: the current one)
 * @returns {{ eligible, years, countedYears, amount, capped, reason }}
 */
const computeGratuity = ({
  joinedOn, lastWorkingDay, monthlyWages, fixedTerm = false, rule = GRATUITY_RULES[0],
}) => {
  const service = serviceLength(joinedOn, lastWorkingDay);
  if (!service) return { eligible: false, amount: 0, reason: 'Joining date and last working day are needed' };
  const minYears = fixedTerm ? rule.minYearsFixedTerm : rule.minYears;
  if (service.years < minYears) {
    return {
      eligible: false, years: service.years, amount: 0, reason: `Less than ${minYears} year${minYears === 1 ? '' : 's'} of service`,
    };
  }
  const wages = Math.max(0, Math.round(Number(monthlyWages) || 0));
  let amount;
  let countedYears;
  if (fixedTerm) {
    // Pro rata: whole years plus the part year as days ÷ 365.
    countedYears = service.years + service.days / 365;
    amount = mulDiv(wages, rule.factor.num * (service.years * 365 + service.days), rule.factor.den * 365 * 100) * 100;
  } else {
    countedYears = service.years + (service.moreThanSixMonths ? 1 : 0);
    amount = mulDiv(wages, rule.factor.num * countedYears, rule.factor.den * 100) * 100;
  }
  const capped = amount > rule.ceiling;
  return {
    eligible: true,
    years: service.years,
    extraDays: service.days,
    countedYears,
    amount: capped ? rule.ceiling : amount,
    capped,
    rule: rule.id,
  };
};

module.exports = { GRATUITY_RULES, serviceLength, computeGratuity };
