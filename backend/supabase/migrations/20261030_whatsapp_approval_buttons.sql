-- 20261030_whatsapp_approval_buttons.sql
-- Approve / Reject buttons on WhatsApp approval requests (leave, work from
-- home, expense claims, attendance corrections).
--
-- Adds one new table only. No existing table, column or row is touched; until
-- Meta approves the approval_request template, approval requests keep going
-- out exactly as before (approval_waiting, no buttons).
--
-- 1. whatsapp_actions — one set of Approve / Reject buttons per approval message
--
-- The approval message now also carries the requester's reason (owner's
-- decision, 30 Oct 2026). whatsapp_messages.params keeps it only until the
-- message is sent; the worker then replaces it with "(hidden)".

CREATE TABLE IF NOT EXISTS whatsapp_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The approval message these buttons belong to.
  message_id UUID NOT NULL UNIQUE REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  -- SHA-256 of the code inside the buttons, set when the message is sent
  -- (a resend gets a new code). The code itself is never stored.
  token_hash CHAR(64) UNIQUE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- employees.id of the approver: only their own connected WhatsApp can use
  -- the buttons, and the decision runs with their rights, as on the website.
  approver_id UUID NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('leave', 'wfh', 'expense', 'regularization')),
  -- leaves.id, wfh_day_requests.batch_id, reimbursements.id or helpdesk_tickets.id
  record_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set on the first tap; the buttons never work twice.
  used_at TIMESTAMPTZ,
  decision VARCHAR(10) CHECK (decision IN ('approve', 'reject')),
  -- approved, rejected, refused (the website's rules said no), or failed.
  outcome VARCHAR(20),
  outcome_detail VARCHAR(300)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_actions_approver ON whatsapp_actions(approver_id, created_at DESC);

-- Backend-only (service role); no public policies.
ALTER TABLE whatsapp_actions ENABLE ROW LEVEL SECURITY;
