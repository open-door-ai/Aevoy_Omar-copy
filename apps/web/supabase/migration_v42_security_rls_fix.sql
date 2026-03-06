-- Migration v42: Security hardening — RLS on failure_memory and admin tables
-- Fixes HIGH-severity findings from security audit (2026-03-06)

-- 1. failure_memory: explicitly enable RLS (table existed without it)
ALTER TABLE IF EXISTS failure_memory ENABLE ROW LEVEL SECURITY;

-- Drop the catch-all true policy if it exists, replace with explicit deny + service-role allow
DROP POLICY IF EXISTS "Service role can manage failure_memory" ON failure_memory;

CREATE POLICY "Service role manages failure_memory"
  ON failure_memory FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny authenticated users from failure_memory"
  ON failure_memory FOR ALL
  TO authenticated
  USING (false);

-- 2. Admin tables: enable RLS (created without it in v34)
ALTER TABLE IF EXISTS admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admin_audit_log ENABLE ROW LEVEL SECURITY;

-- admin_sessions: service role only
DROP POLICY IF EXISTS "Deny users from admin_sessions" ON admin_sessions;
DROP POLICY IF EXISTS "Service role manages admin_sessions" ON admin_sessions;
CREATE POLICY "Service role manages admin_sessions"
  ON admin_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Deny users from admin_sessions"
  ON admin_sessions FOR ALL TO authenticated USING (false);

-- admin_login_attempts: service role only
DROP POLICY IF EXISTS "Deny users from admin_login_attempts" ON admin_login_attempts;
DROP POLICY IF EXISTS "Service role manages admin_login_attempts" ON admin_login_attempts;
CREATE POLICY "Service role manages admin_login_attempts"
  ON admin_login_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Deny users from admin_login_attempts"
  ON admin_login_attempts FOR ALL TO authenticated USING (false);

-- admin_audit_log: service role only
DROP POLICY IF EXISTS "Deny users from admin_audit_log" ON admin_audit_log;
DROP POLICY IF EXISTS "Service role manages admin_audit_log" ON admin_audit_log;
CREATE POLICY "Service role manages admin_audit_log"
  ON admin_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Deny users from admin_audit_log"
  ON admin_audit_log FOR ALL TO authenticated USING (false);
