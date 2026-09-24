-- HMAC-SHA256 tamper-protection for audit log rows.
-- AUDIT_LOG_HMAC_KEY env var is used to sign payloads; falls back to JWT_SECRET with a warning.
-- Backfill runs automatically after this column is added via the verifyAuditLogIntegrity cron.

ALTER TABLE employee_audit_logs
  ADD COLUMN IF NOT EXISTS signature TEXT;

COMMENT ON COLUMN employee_audit_logs.signature IS 'HMAC-SHA256 hex string signing the row payload (excluding created_at, which is DB-generated). Verifiable via utils/auditIntegrity.js.';
