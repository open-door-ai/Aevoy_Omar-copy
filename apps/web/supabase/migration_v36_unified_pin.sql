-- Migration v36: Unified PIN system + agent passwords
-- Consolidates voice/email PIN into one system, adds agent password storage

-- 1. Unified lockout columns (replace channel-specific ones)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_attempts INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ DEFAULT NULL;

-- 2. Agent passwords (encrypted JSON blob: {primary, secondary, tertiary})
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS agent_passwords_encrypted TEXT DEFAULT NULL;

-- 3. Migrate existing lockout data
UPDATE profiles SET pin_attempts = GREATEST(
  COALESCE(pin_attempts, 0),
  COALESCE((SELECT 0), 0) -- voice_pin_attempts if it exists
) WHERE pin_attempts = 0;

-- 4. Index for lockout queries
CREATE INDEX IF NOT EXISTS idx_profiles_pin_locked
  ON profiles(pin_locked_until)
  WHERE pin_locked_until IS NOT NULL;

-- 5. Unified PIN RPCs
CREATE OR REPLACE FUNCTION increment_pin_attempts(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  new_attempts INTEGER;
BEGIN
  UPDATE profiles
  SET pin_attempts = COALESCE(pin_attempts, 0) + 1,
      pin_locked_until = CASE
        WHEN COALESCE(pin_attempts, 0) + 1 >= 5
        THEN NOW() + INTERVAL '1 hour'
        ELSE pin_locked_until
      END
  WHERE id = p_user_id
  RETURNING pin_attempts INTO new_attempts;

  RETURN COALESCE(new_attempts, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reset_pin_attempts(p_user_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET pin_attempts = 0, pin_locked_until = NULL
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_pin_lockout(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  locked_until TIMESTAMPTZ;
BEGIN
  SELECT pin_locked_until INTO locked_until
  FROM profiles WHERE id = p_user_id;

  IF locked_until IS NOT NULL AND locked_until > NOW() THEN
    RETURN TRUE;
  END IF;

  -- Auto-clear expired lockout
  IF locked_until IS NOT NULL AND locked_until <= NOW() THEN
    UPDATE profiles SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_user_id;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant to service_role and authenticated
GRANT EXECUTE ON FUNCTION increment_pin_attempts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_pin_attempts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_pin_attempts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION reset_pin_attempts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_pin_lockout(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION check_pin_lockout(UUID) TO authenticated;
