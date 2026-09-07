-- =============================================================================
-- Item 4: manual payment recording against an existing invoice — closes the
-- gap between "Create Manual Invoice" (creates a NEW already-paid invoice)
-- and reconciling a real offline payment (bank transfer/cheque/cash)
-- against an invoice that already exists in a non-paid status.
-- =============================================================================

-- 'partially_paid': distinct from 'paid' when the recorded amount is less
-- than the invoice total. Deliberately NOT read by the login-gate/
-- export-gate logic (auth.service.js / exportGate.service.js) — both key
-- purely off company_billing_subscriptions.status and never consult
-- invoices at all, so a partially_paid invoice is already treated
-- identically to unpaid/pending there by construction, with no code
-- change needed to preserve that.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'subscription_invoices'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE subscription_invoices DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE subscription_invoices ADD CONSTRAINT subscription_invoices_status_check
    CHECK (status IN (
      'draft', 'pending', 'paid', 'partially_paid', 'failed', 'refunded', 'void'
    ));
END $$;

-- Running total actually received against this invoice — lets a partial
-- payment be recorded and later topped up without losing track of how
-- much of the total has been reconciled so far.
ALTER TABLE subscription_invoices
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN subscription_invoices.amount_paid IS
  'Running total actually recorded as received via record-payment. May be less than amount (status=partially_paid) or equal to it (status=paid). Not touched by issueManualInvoice/issueManualCredit, which already mark themselves fully paid at creation.';
