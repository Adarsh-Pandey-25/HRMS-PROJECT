-- Full and final settlement: the tax-free part of gratuity and leave encashment
-- (audit #14). Gratuity is tax-free up to the statutory gratuity and ₹20 lakh,
-- leave encashed on leaving up to ₹25 lakh, 10 months' average salary and the
-- leave's cash value (30 days a completed year) — less any exemption the person
-- already used with a previous employer, which HR enters on the settlement.
-- exempt_amount is that tax-free part of a one-time item; income tax (TDS) is
-- worked out on amount − exempt_amount, and the payslip shows both parts.
-- Additive and safe to run more than once. Until it runs, the settlement adds
-- the tax-free part and the taxable part as two items, so the tax is right
-- either way. Needs 20261104_payroll_one_time_items.sql first (skipped without it).

ALTER TABLE IF EXISTS payroll_one_time_items
  ADD COLUMN IF NOT EXISTS exempt_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF to_regclass('public.payroll_one_time_items') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_one_time_items_exempt_amount_check') THEN
    ALTER TABLE payroll_one_time_items
      ADD CONSTRAINT payroll_one_time_items_exempt_amount_check CHECK (exempt_amount >= 0 AND exempt_amount <= amount);
  END IF;
END $$;
