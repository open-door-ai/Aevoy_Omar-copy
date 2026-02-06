-- Migration v11: Session Persistence Encryption + Proactive Limit Control
-- Created: 2026-02-06
-- Purpose: Add encrypted session storage and user-configurable proactive limits

-- 1. Add encrypted session data column to user_sessions
-- This allows secure storage of cookies and localStorage data
ALTER TABLE user_sessions
ADD COLUMN IF NOT EXISTS session_data_encrypted TEXT;

-- Migrate existing unencrypted data (if any exists)
-- Note: This will need manual re-encryption in production
-- For now, we'll just mark old data as requiring re-login
COMMENT ON COLUMN user_sessions.session_data_encrypted IS 'AES-256-GCM encrypted session data (cookies + localStorage)';

-- 2. Add proactive daily limit to user_settings
-- Allows users to control how many proactive notifications they receive per day
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS proactive_daily_limit INTEGER DEFAULT 10
CHECK (proactive_daily_limit >= 0 AND proactive_daily_limit <= 20);

COMMENT ON COLUMN user_settings.proactive_daily_limit IS 'Max proactive messages per day (0=off, 10=default, 20=max)';

-- 3. Add index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_encrypted
ON user_sessions(user_id, domain)
WHERE session_data_encrypted IS NOT NULL AND expires_at > NOW();

-- 4. Update DATABASE.md documentation (manual step)
-- TODO: Add user_sessions table to docs/DATABASE.md
-- TODO: Add proactive_daily_limit to user_settings documentation
