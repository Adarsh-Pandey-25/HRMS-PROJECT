/**
 * GST for subscription billing. Plan prices and invoice amounts are stored
 * as the BASE amount (exclusive of GST). GST is never stored — it is derived
 * here wherever an amount is shown, charged or collected, so a rate change
 * needs no data migration.
 *
 * Amounts are rounded to the paisa (2 decimals) because they appear on tax
 * invoices; UI copy may round further for display.
 */
const GST_RATE = Number.isFinite(Number(process.env.GST_RATE)) && process.env.GST_RATE !== ''
  ? Number(process.env.GST_RATE)
  : 0.18;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** @returns {{ base: number, gstRate: number, gstAmount: number, total: number }} */
const applyGst = (baseAmount, gstRate = GST_RATE) => {
  const base = round2(baseAmount);
  const gstAmount = round2(base * gstRate);
  return { base, gstRate, gstAmount, total: round2(base + gstAmount) };
};

/** Amount the customer actually owes / is charged for an invoice (base + GST). */
const grossAmount = (baseAmount) => applyGst(baseAmount).total;

/** Adds GST fields to an invoice row without changing what is stored. */
const withInvoiceGst = (invoice) => {
  if (!invoice) return invoice;
  const { gstRate, gstAmount, total } = applyGst(invoice.amount);
  return {
    ...invoice,
    gst_rate: gstRate,
    gst_amount: gstAmount,
    total_amount: total,
    gst_inclusive: false,
  };
};

module.exports = {
  GST_RATE, applyGst, grossAmount, withInvoiceGst,
};
