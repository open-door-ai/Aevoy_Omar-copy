-- v38: Global Hive Mind — cross-user anonymized learnings + failure-fix pairs

-- Global learnings (anonymized, cross-user patterns)
CREATE TABLE IF NOT EXISTS global_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,                    -- e.g., 'amazon.com', 'restaurant_booking'
  task_type TEXT NOT NULL,                 -- e.g., 'signup', 'booking', 'research'
  approach TEXT NOT NULL,                  -- what was done (anonymized)
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  fix TEXT,                                -- if outcome=success after failure: what fixed it
  success_rate FLOAT DEFAULT 1.0,          -- EMA-updated
  times_used INTEGER DEFAULT 1,
  confidence_score FLOAT DEFAULT 0.5,      -- success_rate * log(times_used+1), normalized
  contributed_by_count INTEGER DEFAULT 1,  -- how many distinct users contributed
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- NO user_id column — these are fully anonymized
  CONSTRAINT global_learnings_approach_domain UNIQUE (domain, task_type, approach)
);

-- Failure-fix pairs (per-user: what failed, what fixed it)
CREATE TABLE IF NOT EXISTS failure_fixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID,
  domain TEXT NOT NULL,
  task_type TEXT NOT NULL,
  failure_reason TEXT NOT NULL,           -- what error/approach failed
  failure_approach TEXT NOT NULL,         -- the specific action that failed
  successful_fix TEXT NOT NULL,           -- the approach that finally worked
  fix_category TEXT,                      -- 'oauth_fallback', 'mobile_site', 'coordinate_click', etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add model performance table if not exists (needed by model-intelligence.ts)
CREATE TABLE IF NOT EXISTS model_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  task_type TEXT NOT NULL,
  domain TEXT DEFAULT '',
  successes INTEGER DEFAULT 0,
  failures INTEGER DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  total_cost_usd FLOAT DEFAULT 0,
  total_latency_ms BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, model, task_type, domain)
);

-- Add contribute_to_hive_mind opt-out flag to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS contribute_to_hive_mind BOOLEAN DEFAULT true;

-- RLS
ALTER TABLE failure_fixes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own failure_fixes" ON failure_fixes FOR ALL USING (auth.uid() = user_id);

-- global_learnings: readable by all authenticated users, no RLS needed (anonymized)
-- Service role can write; anon cannot
ALTER TABLE global_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read global_learnings" ON global_learnings FOR SELECT USING (true);
CREATE POLICY "Service role writes global_learnings" ON global_learnings FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role updates global_learnings" ON global_learnings FOR UPDATE USING (auth.role() = 'service_role');

-- Upsert function for model performance (called by model-intelligence.ts)
CREATE OR REPLACE FUNCTION upsert_model_performance(
  p_user_id UUID,
  p_model TEXT,
  p_task_type TEXT,
  p_domain TEXT,
  p_success BOOLEAN,
  p_tokens INTEGER,
  p_cost_usd FLOAT,
  p_latency_ms INTEGER
) RETURNS VOID AS $$
BEGIN
  INSERT INTO model_performance (user_id, model, task_type, domain, successes, failures, total_tokens, total_cost_usd, total_latency_ms)
  VALUES (p_user_id, p_model, p_task_type, p_domain,
          CASE WHEN p_success THEN 1 ELSE 0 END,
          CASE WHEN NOT p_success THEN 1 ELSE 0 END,
          p_tokens, p_cost_usd, p_latency_ms)
  ON CONFLICT (user_id, model, task_type, domain) DO UPDATE SET
    successes = model_performance.successes + (CASE WHEN p_success THEN 1 ELSE 0 END),
    failures = model_performance.failures + (CASE WHEN NOT p_success THEN 1 ELSE 0 END),
    total_tokens = model_performance.total_tokens + p_tokens,
    total_cost_usd = model_performance.total_cost_usd + p_cost_usd,
    total_latency_ms = model_performance.total_latency_ms + p_latency_ms,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
