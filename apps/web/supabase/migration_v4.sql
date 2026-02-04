-- Migration V4: Reliability improvements
-- Adds: user_sessions table, checkpoint_data column, global failure memory support

-- User sessions table for persistent login across tasks
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  UNIQUE(user_id, domain)
);

-- RLS for user_sessions
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sessions"
  ON user_sessions FOR ALL
  USING (auth.uid() = user_id);

-- Index for session lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_lookup
  ON user_sessions(user_id, domain)
  WHERE expires_at > now();

-- Add checkpoint_data to tasks table for resume support
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'checkpoint_data'
  ) THEN
    ALTER TABLE tasks ADD COLUMN checkpoint_data JSONB DEFAULT NULL;
  END IF;
END $$;

-- Add last_seen_at to failure_memory if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'failure_memory' AND column_name = 'last_seen_at'
  ) THEN
    ALTER TABLE failure_memory ADD COLUMN last_seen_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Atomic record failure function for race-condition-safe upserts
CREATE OR REPLACE FUNCTION atomic_record_failure(
  p_site_domain TEXT,
  p_action_type TEXT,
  p_original_selector TEXT DEFAULT '',
  p_error_type TEXT DEFAULT '',
  p_solution_method TEXT DEFAULT NULL,
  p_solution_selector TEXT DEFAULT NULL,
  p_success_rate NUMERIC DEFAULT 0,
  p_ema_weight NUMERIC DEFAULT 0.3
) RETURNS void AS $$
DECLARE
  v_existing_rate NUMERIC;
  v_existing_uses INTEGER;
  v_new_rate NUMERIC;
BEGIN
  -- Attempt atomic upsert with EMA calculation
  INSERT INTO failure_memory (
    site_domain, action_type, original_selector, error_type,
    solution_method, solution_selector, times_used, success_rate, last_seen_at
  )
  VALUES (
    p_site_domain, p_action_type, p_original_selector, p_error_type,
    p_solution_method, p_solution_selector, 1, p_success_rate, now()
  )
  ON CONFLICT (site_domain, action_type, original_selector) DO UPDATE SET
    error_type = p_error_type,
    solution_method = COALESCE(p_solution_method, failure_memory.solution_method),
    solution_selector = COALESCE(p_solution_selector, failure_memory.solution_selector),
    times_used = failure_memory.times_used + 1,
    success_rate = p_ema_weight * p_success_rate + (1 - p_ema_weight) * failure_memory.success_rate,
    last_seen_at = now();
END;
$$ LANGUAGE plpgsql;

-- Index for global failure memory queries (cross-user learning)
CREATE INDEX IF NOT EXISTS idx_failure_memory_global
  ON failure_memory(site_domain, action_type, times_used DESC, success_rate DESC)
  WHERE times_used >= 3 AND success_rate > 70;

-- Cleanup old sessions (can be called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;
