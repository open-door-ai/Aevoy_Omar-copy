-- Migration v17: Permanent Sessions & Autonomous Execution
-- Purpose: Update session expiry to 1 year, add autonomous execution tables

-- ============================================================================
-- UPDATE USER_SESSIONS TO PERMANENT (1 YEAR)
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
-- USER SETTINGS FOR AUTONOMOUS BEHAVIOR
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
-- TASK QUEUE FOR EXECUTION
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES execution_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_queue_status ON task_queue(status, created_at);
CREATE INDEX idx_task_queue_user ON task_queue(user_id, status);

ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task queue"
  ON task_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to task queue"
  ON task_queue FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE task_queue IS 'Queue for autonomous task execution';

-- ============================================================================
-- EXECUTION PLANS ENHANCEMENTS
-- ============================================================================

ALTER TABLE execution_plans
ADD COLUMN IF NOT EXISTS high_stakes JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

COMMENT ON COLUMN execution_plans.high_stakes IS 'Flags for high-stakes actions (spending, canceling, etc)';

-- ============================================================================
-- BACKGROUND REFRESH FUNCTION
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
-- CAPTCHA SOLVING LOG
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

CREATE INDEX idx_captcha_solves_user ON captcha_solves(user_id, created_at DESC);
CREATE INDEX idx_captcha_solves_success ON captcha_solves(success, captcha_type);

ALTER TABLE captcha_solves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to captcha_solves"
  ON captcha_solves FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE captcha_solves IS 'Log of CAPTCHA solving attempts for analytics';

-- ============================================================================
-- QUALITY CHECKS LOG
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

CREATE INDEX idx_quality_checks_user ON quality_checks(user_id, created_at DESC);
CREATE INDEX idx_quality_checks_passed ON quality_checks(passed, score);

ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to quality_checks"
  ON quality_checks FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE quality_checks IS 'Quality verification results for task execution';

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT ALL ON task_queue TO service_role;
GRANT ALL ON captcha_solves TO service_role;
GRANT ALL ON quality_checks TO service_role;
