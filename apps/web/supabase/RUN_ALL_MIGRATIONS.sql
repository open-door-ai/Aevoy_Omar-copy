-- ============================================================================
-- ALL MIGRATIONS - Run this in Supabase SQL Editor
-- Includes: v17 (permanent sessions) + v18 (browser contexts) + fixes
-- ============================================================================

-- ============================================================================
-- PART 1: UPDATE USER_SESSIONS TO PERMANENT (1 YEAR)
-- ============================================================================

-- Update existing sessions to 1 year expiry
UPDATE user_sessions 
SET expires_at = NOW() + INTERVAL '1 year'
WHERE expires_at > NOW();

-- Update default for new sessions
ALTER TABLE user_sessions 
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '1 year');

COMMENT ON COLUMN user_sessions.expires_at IS 'Session expiry - 1 year from creation/refresh';

-- ============================================================================
-- PART 2: USER SETTINGS FOR AUTONOMOUS BEHAVIOR
-- ============================================================================

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS confirm_spending BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS confirm_canceling BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS confirm_deleting BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS confirm_sharing BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS max_autonomous_spend DECIMAL(10,2) DEFAULT 100.00,
ADD COLUMN IF NOT EXISTS response_timeout_minutes INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS quality_threshold INTEGER DEFAULT 99 CHECK (quality_threshold IN (90, 95, 99));

COMMENT ON COLUMN user_settings.confirm_spending IS 'Require confirmation before spending money';
COMMENT ON COLUMN user_settings.confirm_canceling IS 'Require confirmation before canceling subscriptions';
COMMENT ON COLUMN user_settings.confirm_deleting IS 'Require confirmation before deleting accounts';
COMMENT ON COLUMN user_settings.confirm_sharing IS 'Require confirmation before sharing personal info';
COMMENT ON COLUMN user_settings.max_autonomous_spend IS 'Maximum $ agent can spend without confirmation';
COMMENT ON COLUMN user_settings.response_timeout_minutes IS 'How long to wait for user response before continuing autonomously';
COMMENT ON COLUMN user_settings.quality_threshold IS 'Quality percentile threshold (90, 95, or 99)';

-- ============================================================================
-- PART 3: BROWSER CONTEXTS (NEW TABLE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.browser_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_state_encrypted TEXT,  -- Full Playwright storage state
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_browser_contexts_user ON browser_contexts(user_id);

ALTER TABLE browser_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their browser context"
  ON browser_contexts FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages browser contexts"
  ON browser_contexts FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE browser_contexts IS 'Playwright storage state per user for shared browser isolation';

-- ============================================================================
-- PART 4: VPS INSTANCE TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vps_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'full', 'maintenance', 'offline')),
  context_count INTEGER DEFAULT 0,
  max_contexts INTEGER DEFAULT 100,
  region TEXT,
  provider TEXT, -- 'gcp', 'aws', 'azure', 'hetzner'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vps_status ON vps_instances(status, context_count);

ALTER TABLE vps_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages VPS"
  ON vps_instances FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE vps_instances IS 'Track VPS instances running shared Chrome browsers';

-- ============================================================================
-- PART 5: USER TO VPS MAPPING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_vps_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_vps_user ON user_vps_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_vps_vps ON user_vps_assignments(vps_id);

ALTER TABLE user_vps_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages VPS assignments"
  ON user_vps_assignments FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE user_vps_assignments IS 'Assign users to specific VPS instances';

-- ============================================================================
-- PART 6: CAPTCHA SOLVING LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.captcha_solves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  captcha_type TEXT NOT NULL,
  method TEXT NOT NULL, -- '2captcha', 'vision', 'manual'
  success BOOLEAN NOT NULL,
  cost_usd DECIMAL(10,6),
  solve_time_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_captcha_solves_user ON captcha_solves(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captcha_solves_success ON captcha_solves(success, captcha_type);

ALTER TABLE captcha_solves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to captcha_solves"
  ON captcha_solves FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE captcha_solves IS 'Log of CAPTCHA solving attempts for analytics';

-- ============================================================================
-- PART 7: QUALITY CHECKS LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quality_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  percentile DECIMAL(4,1) NOT NULL,
  threshold INTEGER NOT NULL,
  passed BOOLEAN NOT NULL,
  attempts INTEGER DEFAULT 1,
  breakdown JSONB,
  feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_checks_user ON quality_checks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_checks_passed ON quality_checks(passed, score);

ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to quality_checks"
  ON quality_checks FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE quality_checks IS 'Quality verification results for task execution';

-- ============================================================================
-- PART 8: UPDATE EXECUTION_PLANS
-- ============================================================================

ALTER TABLE execution_plans
ADD COLUMN IF NOT EXISTS high_stakes JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS confirmation_channel TEXT,
ADD COLUMN IF NOT EXISTS modifications TEXT,
ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ;

COMMENT ON COLUMN execution_plans.high_stakes IS 'Flags for high-stakes actions (spending, canceling, etc)';

-- ============================================================================
-- PART 9: BACKGROUND REFRESH FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_expiring_sessions()
RETURNS INTEGER AS $$
DECLARE
  refreshed_count INTEGER := 0;
BEGIN
  UPDATE user_sessions 
  SET 
    expires_at = NOW() + INTERVAL '1 year',
    last_used_at = NOW()
  WHERE expires_at < NOW() + INTERVAL '30 days'
    AND expires_at > NOW();
  
  GET DIAGNOSTICS refreshed_count = ROW_COUNT;
  RETURN refreshed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refresh_expiring_sessions() IS 'Refresh sessions expiring within 30 days - run daily via cron';

-- ============================================================================
-- PART 10: HELPER FUNCTIONS
-- ============================================================================

-- Get least loaded VPS for new user assignment
CREATE OR REPLACE FUNCTION get_available_vps()
RETURNS TABLE (vps_id UUID, host TEXT, port INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT v.id, v.host, v.port
  FROM vps_instances v
  WHERE v.status = 'active'
    AND v.context_count < v.max_contexts
  ORDER BY v.context_count ASC
  LIMIT 1;
END;
$$;

-- Assign user to VPS
CREATE OR REPLACE FUNCTION assign_user_to_vps(p_user_id UUID)
RETURNS TABLE (vps_id UUID, host TEXT, port INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_vps_id UUID;
  v_host TEXT;
  v_port INTEGER;
BEGIN
  -- Check if already assigned
  SELECT va.vps_id, v.host, v.port
  INTO v_vps_id, v_host, v_port
  FROM user_vps_assignments va
  JOIN vps_instances v ON v.id = va.vps_id
  WHERE va.user_id = p_user_id;

  IF FOUND THEN
    RETURN QUERY SELECT v_vps_id, v_host, v_port;
    RETURN;
  END IF;

  -- Get available VPS
  SELECT id, host, port
  INTO v_vps_id, v_host, v_port
  FROM get_available_vps();

  IF FOUND THEN
    -- Create assignment
    INSERT INTO user_vps_assignments (user_id, vps_id)
    VALUES (p_user_id, v_vps_id);

    -- Increment context count
    UPDATE vps_instances
    SET context_count = context_count + 1
    WHERE id = v_vps_id;

    RETURN QUERY SELECT v_vps_id, v_host, v_port;
  END IF;
END;
$$;

-- ============================================================================
-- PART 11: GRANTS
-- ============================================================================

GRANT ALL ON browser_contexts TO service_role;
GRANT ALL ON vps_instances TO service_role;
GRANT ALL ON user_vps_assignments TO service_role;
GRANT ALL ON captcha_solves TO service_role;
GRANT ALL ON quality_checks TO service_role;

-- ============================================================================
-- DONE!
-- ============================================================================

SELECT 'All migrations completed successfully!' AS status;
