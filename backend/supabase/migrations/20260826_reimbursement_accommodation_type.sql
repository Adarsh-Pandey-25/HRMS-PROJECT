-- "Accommodation" and "Other" reimbursements were indistinguishable in
-- reports because both mapped to the same 'other' enum value. Add a real
-- value. Run in Supabase SQL Editor (must run as its own statement, not
-- combined into an explicit transaction, and any later statement that
-- reads the new value must be a separate run — plain SQL Editor execution
-- of this whole file satisfies that).
ALTER TYPE reimbursement_type ADD VALUE IF NOT EXISTS 'accommodation';
