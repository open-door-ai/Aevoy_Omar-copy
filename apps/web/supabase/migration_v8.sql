-- Migration V8: Integration & Execution Engine
-- Applied: 2026-02-05
-- Adds: OAuth connections, credential vault, Twilio numbers, TFA codes,
--        skills registry, execution plans, task queue, AI cost logging
-- Extends: learnings table with layout tracking columns
-- RPCs: cleanup_expired_tfa_codes, get_latest_tfa_code

-- =============================================================================
-- 1. OAuth Connections (Google, Microsoft tokens — encrypted)
-- =============================================================================
CREATE TABLE IF NOT EXISTS oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMPTZ,
  scopes TEXT[] DEFAULT '{}',
  account_email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider, account_email)
);

ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own oauth" ON oauth_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manage oauth" ON oauth_connections FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 2. Credential Vault (site logins — encrypted)
-- =============================================================================
CREATE TABLE IF NOT EXISTS credential_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  site_domain TEXT NOT NULL,
  username_encrypted TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  tfa_method TEXT CHECK (tfa_method IN ('totp', 'sms', 'email', 'app')),
  tfa_secret_encrypted TEXT,
  twilio_switched BOOLEAN DEFAULT false,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, site_domain)
);

ALTER TABLE credential_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own creds" ON credential_vault FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manage creds" ON credential_vault FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 3. User Twilio Numbers (dedicated numbers per user)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_twilio_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  twilio_sid TEXT,
  purpose TEXT NOT NULL DEFAULT 'primary' CHECK (purpose IN ('primary', 'tfa', 'voice')),
  is_active BOOLEAN DEFAULT true,
  area_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, purpose)
);

ALTER TABLE user_twilio_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own numbers" ON user_twilio_numbers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manage numbers" ON user_twilio_numbers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 4. TFA Codes (auto-extracted from email/SMS, or TOTP-generated)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tfa_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  task_id UUID,
  code TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('email', 'sms', 'totp', 'app')),
  site_domain TEXT,
  used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tfa_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service manage tfa" ON tfa_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 5. Skills Registry (API-callable actions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  required_scopes TEXT[] DEFAULT '{}',
  api_endpoint TEXT,
  method TEXT DEFAULT 'POST',
  input_schema JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read skills" ON skills FOR SELECT USING (true);
CREATE POLICY "Service manage skills" ON skills FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 6. Execution Plans (plan-then-execute tracking)
-- =============================================================================
CREATE TABLE IF NOT EXISTS execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID,
  user_id UUID NOT NULL,
  plan_steps JSONB NOT NULL DEFAULT '[]',
  execution_method TEXT NOT NULL CHECK (execution_method IN ('api', 'browser_cached', 'browser_new', 'direct', 'manual')),
  approved BOOLEAN DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  estimated_cost NUMERIC DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE execution_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own plans" ON execution_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manage plans" ON execution_plans FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 7. Task Queue (overnight / priority queue)
-- =============================================================================
CREATE TABLE IF NOT EXISTS task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  parent_task_id UUID,
  description TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  result JSONB,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own queue" ON task_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manage queue" ON task_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 8. AI Cost Log (per-call cost tracking)
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_cost_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  task_id UUID,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  purpose TEXT,
  cached BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_cost_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own costs" ON ai_cost_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service manage costs" ON ai_cost_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Index for cost aggregation queries
CREATE INDEX IF NOT EXISTS idx_ai_cost_log_user ON ai_cost_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_cost_log_task ON ai_cost_log(task_id);

-- =============================================================================
-- 9. Extend Learnings table (layout tracking for browser automation)
-- =============================================================================
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS page_hash TEXT;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS layout_version INTEGER DEFAULT 1;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS layout_verified_at TIMESTAMPTZ;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS recorded_steps JSONB;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS url_pattern TEXT;

-- =============================================================================
-- 10. RPCs for TFA management
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_tfa_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM tfa_codes WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_latest_tfa_code(p_user_id UUID, p_site_domain TEXT)
RETURNS TABLE(code TEXT, source TEXT, created_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT tc.code, tc.source, tc.created_at
  FROM tfa_codes tc
  WHERE tc.user_id = p_user_id
    AND tc.site_domain = p_site_domain
    AND tc.used = false
    AND tc.expires_at > now()
  ORDER BY tc.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
