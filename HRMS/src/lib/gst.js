/**
 * GST for subscription pricing. Every price and invoice amount from the API is
 * the BASE amount, exclusive of GST (backend/src/utils/gst.js). Use this one
 * helper wherever a price is shown so the maths never drifts between screens.
 */
export const GST_RATE = 0.18;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** @returns {{ base: number, gstRate: number, gst: number, total: number }} */
export function applyGST(baseAmount, gstRate = GST_RATE) {
  const base = round2(baseAmount);
  const gst = round2(base * gstRate);
  return { base, gstRate, gst, total: round2(base + gst) };
}

export const gstPercentLabel = (gstRate = GST_RATE) => `${Math.round(gstRate * 100)}%`;
