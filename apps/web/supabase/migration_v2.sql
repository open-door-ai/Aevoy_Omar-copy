-- Handlit Database Migration V2
-- Run this in Supabase SQL Editor AFTER the initial migration
-- Adds: failure_memory, user_credentials, user_memory, usage tracking, payments

-- =====================================================
-- 1. Failure Memory Table (Global learning across all users)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.failure_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_domain VARCHAR(255) NOT NULL,
  site_path VARCHAR(500),
  action_type VARCHAR(50) NOT NULL,
  original_selector VARCHAR(1000) DEFAULT '',
  original_method VARCHAR(50),
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT,
  solution_method VARCHAR(50),
  solution_selector VARCHAR(1000),
  solution_steps JSONB,
  success_rate DECIMAL(5,2) DEFAULT 100.00,
  times_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_failure UNIQUE(site_domain, action_type, original_selector)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_failure_lookup ON failure_memory(site_domain, action_type);
CREATE INDEX IF NOT EXISTS idx_failure_success ON failure_memory(success_rate DESC);

-- =====================================================
-- 2. User Credentials Table (Encrypted with user's key)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  site_domain VARCHAR(255) NOT NULL,
  encrypted_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_site UNIQUE(user_id, site_domain)
);

CREATE INDEX IF NOT EXISTS idx_user_creds ON user_credentials(user_id, site_domain);

-- RLS for user credentials
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own credentials" ON user_credentials 
  FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- 3. User Memory Table (Encrypted user preferences/facts)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  encrypted_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_memory ON user_memory(user_id);

ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own memory" ON user_memory 
  FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- 4. Usage Tracking Table (Per-month usage stats)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
  browser_tasks INTEGER DEFAULT 0,
  simple_tasks INTEGER DEFAULT 0,
  sms_count INTEGER DEFAULT 0,
  voice_minutes INTEGER DEFAULT 0,
  ai_cost_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_month UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage(user_id, month);

ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own usage" ON usage 
  FOR SELECT USING (auth.uid() = user_id);

-- =====================================================
-- 5. Add Stripe fields to profiles (if not exist)
-- =====================================================
ALTER TABLE profiles 
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- =====================================================
-- 6. Function to track usage by type
-- =====================================================
CREATE OR REPLACE FUNCTION track_usage(
  p_user_id UUID,
  p_task_type VARCHAR(50),
  p_ai_cost_cents INTEGER DEFAULT 0
)
RETURNS VOID AS $$
DECLARE
  v_month VARCHAR(7);
BEGIN
  v_month := TO_CHAR(NOW(), 'YYYY-MM');
  
  INSERT INTO usage (user_id, month, browser_tasks, simple_tasks, ai_cost_cents)
  VALUES (
    p_user_id,
    v_month,
    CASE WHEN p_task_type IN ('booking', 'form', 'shopping') THEN 1 ELSE 0 END,
    CASE WHEN p_task_type NOT IN ('booking', 'form', 'shopping') THEN 1 ELSE 0 END,
    p_ai_cost_cents
  )
  ON CONFLICT (user_id, month)
  DO UPDATE SET
    browser_tasks = usage.browser_tasks + CASE WHEN p_task_type IN ('booking', 'form', 'shopping') THEN 1 ELSE 0 END,
    simple_tasks = usage.simple_tasks + CASE WHEN p_task_type NOT IN ('booking', 'form', 'shopping') THEN 1 ELSE 0 END,
    ai_cost_cents = usage.ai_cost_cents + p_ai_cost_cents,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. Service role policies for new tables
-- =====================================================
CREATE POLICY "Service role can manage failure_memory" ON failure_memory
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage user_credentials" ON user_credentials
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage user_memory" ON user_memory
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage usage" ON usage
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 8. Trigger to update timestamps
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_failure_memory_updated_at
  BEFORE UPDATE ON failure_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_credentials_updated_at
  BEFORE UPDATE ON user_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_memory_updated_at
  BEFORE UPDATE ON user_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_usage_updated_at
  BEFORE UPDATE ON usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
