-- Atomic sequential invoice numbering — eliminates collisions and
-- produces gap-free INV-YYYYMMDD-NNNNN format.
--
-- Step 1: the sequence the RPC draws from.
-- Step 2: RPC function that atomically fetches + increments.

-- Step 1. Without this the RPC below compiles fine but throws
-- "relation subscription_invoice_seq does not exist" on every call,
-- which takes down subscription activation, renewal and plan changes.
--
-- START WITH 1001 assumes no existing numeric invoice numbers at or above
-- 1001. Older invoices used a random hex suffix (INV-YYYYMMDD-XXXXXX), so
-- they do not collide with this series. If invoice_number has a unique
-- constraint and any numeric-suffixed rows already exist, bump the start:
--   SELECT setval('subscription_invoice_seq', <highest existing number> + 1);
CREATE SEQUENCE IF NOT EXISTS subscription_invoice_seq
  START WITH 1001
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

-- Step 2.
CREATE OR REPLACE FUNCTION get_next_invoice_number()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN nextval('subscription_invoice_seq');
END;
$$;

-- Let a service_role caller invoke the RPC.
GRANT EXECUTE ON FUNCTION get_next_invoice_number() TO service_role;
