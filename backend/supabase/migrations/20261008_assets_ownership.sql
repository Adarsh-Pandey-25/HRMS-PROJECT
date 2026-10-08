-- Whether an asset is owned outright or rented in.
--
-- `assets` recorded purchase_date/purchase_cost but had no way to say the
-- company does not own the thing — a rented laptop looked identical to a
-- bought one. Bulk import now asks for it, so it needs somewhere to land.
--
-- Existing rows become 'purchased': every asset entered so far was recorded
-- with purchase fields, so that is what they are, and it keeps the column
-- NOT NULL without a separate backfill step.
--
-- Additive and idempotent — safe to re-run, and safe to apply before the
-- application code that writes it.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS ownership VARCHAR(20) NOT NULL DEFAULT 'purchased';

COMMENT ON COLUMN assets.ownership IS
  'purchased = company owns it outright; rented = rented in from a vendor. Defaults to purchased.';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS for table constraints, so
-- guard on the catalogue instead of failing a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assets_ownership_check'
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT assets_ownership_check CHECK (ownership IN ('purchased', 'rented'));
  END IF;
END $$;

-- The inventory screen filters by ownership alongside category and status.
CREATE INDEX IF NOT EXISTS idx_assets_company_ownership
  ON assets(company_id, ownership);
