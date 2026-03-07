-- Migration v43: Admin dashboard enhancements
-- Adds fingerprint column to admin tables for device tracking
-- Adds kill switch support via distributed_locks

-- 1. Add fingerprint column to admin_sessions
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- 2. Add fingerprint column to admin_login_attempts
ALTER TABLE admin_login_attempts ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- 3. Ensure distributed_locks table exists (for kill switch)
CREATE TABLE IF NOT EXISTS distributed_locks (
  lock_name TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '1 hour'
);

ALTER TABLE distributed_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages locks" ON distributed_locks;
CREATE POLICY "Service role manages locks"
  ON distributed_locks FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Deny users from locks" ON distributed_locks;
CREATE POLICY "Deny users from locks"
  ON distributed_locks FOR ALL TO authenticated USING (false);

-- 4. Admin audit log index for faster queries
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);

-- 5. Index for faster user search in admin
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON profiles(display_name);

-- 6. Cleanup: expire old admin sessions (auto-cleanup on insert)
CREATE OR REPLACE FUNCTION cleanup_expired_admin_sessions()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM admin_sessions WHERE expires_at < now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cleanup_admin_sessions ON admin_sessions;
CREATE TRIGGER trg_cleanup_admin_sessions
  AFTER INSERT ON admin_sessions
  FOR EACH STATEMENT
  EXECUTE FUNCTION cleanup_expired_admin_sessions();
