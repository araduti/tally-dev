-- Audit Log Immutability Trigger
--
-- Enforces immutability on the audit_logs table at the database level.
-- This is a defense-in-depth control complementing the application-level
-- convention of never calling UPDATE or DELETE on AuditLog records.
--
-- Critical for SOC 2 compliance (CC7.2, CC7.3) — audit trail integrity
-- must be guaranteed even if application code contains bugs or is compromised.
--
-- To apply:
--   psql $DATABASE_URL -f prisma/migrations/20260412_audit_log_immutability/migration.sql

-- Trigger function that prevents any UPDATE or DELETE on audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records are immutable — UPDATE and DELETE operations are prohibited';
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to the audit_logs table
-- BEFORE trigger prevents the operation before it touches any rows
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_logs;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();
