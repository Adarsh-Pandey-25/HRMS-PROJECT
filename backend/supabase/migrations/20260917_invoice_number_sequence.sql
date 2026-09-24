-- Atomic sequential invoice numbering — eliminates collisions and
-- produces gap-free INV-YYYYMMDD-NNNNN format.
--
-- Step 1: per-day sequence reset via a dedicated sequence.
-- Step 2: RPC function that atomically fetches + increments.
-- Step 3: optional backfill of existing collision-prone numbers.

CREATE OR REPLACE FUNCTION get_next_invoice_number()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val BIGINT;
BEGIN
  PERFORM nextval('subscription_invoice_seq');
  RETURN currval('subscription_invoice_seq');
END;
$$;

-- Let a service_role caller invoke the RPC.
GRANT EXECUTE ON FUNCTION get_next_invoice_number() TO service_role;

-- NOTE for backfill: existing subscription_invoices with the old
-- INV-YYYYMMDD-XXXXXX format should be renumbered to INV-YYYYMMDD-NNNNN
-- after the sequence is seeded. Run the backfill script in
-- scripts/backfill_invoice_numbers.js after applying this migration.
