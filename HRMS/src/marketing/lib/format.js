const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹2,999 */
export const formatInr = (value) => `₹${inr.format(Number(value) || 0)}`;

/** Annual saving vs paying monthly for 12 months, as a whole percentage (0 when none). */
export const annualSavingPercent = (plan) => {
  const yearlyAtMonthly = (Number(plan.priceMonthly) || 0) * 12;
  const annual = Number(plan.priceAnnual) || 0;
  if (!yearlyAtMonthly || !annual || annual >= yearlyAtMonthly) return 0;
  return Math.round((1 - annual / yearlyAtMonthly) * 100);
};
