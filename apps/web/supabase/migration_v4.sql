-- Aevoy Database Migration V4
-- Run this in Supabase SQL Editor AFTER migration_v3.sql
-- Fixes: RLS policy scoping, adds DELETE policy on tasks, failure_memory table

-- =====================================================
-- 1. Scope service-role policies to service_role only
-- =====================================================

-- Drop overly permissive "FOR ALL USING (true)" policies and recreate scoped to service_role
-- action_history
DROP POLICY IF EXISTS "Service role manages action history" ON action_history;
CREATE POLICY "Service role manages action history" ON action_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- transactions
DROP POLICY IF EXISTS "Service role manages transactions" ON transactions;
CREATE POLICY "Service role manages transactions" ON transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- prepaid_cards
DROP POLICY IF EXISTS "Service role manages cards" ON prepaid_cards;
CREATE POLICY "Service role manages cards" ON prepaid_cards
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- tasks
DROP POLICY IF EXISTS "Service role manages tasks" ON tasks;
CREATE POLICY "Service role manages tasks" ON tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_memory
DROP POLICY IF EXISTS "Service role manages memory" ON user_memory;
CREATE POLICY "Service role manages memory" ON user_memory
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- usage
DROP POLICY IF EXISTS "Service role manages usage" ON usage;
CREATE POLICY "Service role manages usage" ON usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 2. Add DELETE policy on tasks for authenticated users
-- =====================================================

DROP POLICY IF EXISTS "Users can delete own tasks" ON tasks;
CREATE POLICY "Users can delete own tasks" ON tasks
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================
-- 3. Failure Memory Table (global learning)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.failure_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_domain TEXT NOT NULL,
  site_path TEXT,
  action_type TEXT NOT NULL,
  original_selector TEXT,
  original_method TEXT,
  error_type TEXT NOT NULL,
  error_message TEXT,
  solution_method TEXT,
  solution_selector TEXT,
  solution_extra JSONB,
  success_count INT DEFAULT 0,
  fail_count INT DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failure_memory_site ON failure_memory(site_domain, action_type);
CREATE INDEX IF NOT EXISTS idx_failure_memory_selector ON failure_memory(site_domain, original_selector);

-- No RLS on failure_memory — it's global (no user data)
-- Only service role should access it
ALTER TABLE failure_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages failure memory" ON failure_memory
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 4. User Settings Table (confirmation mode, etc.)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  confirmation_mode TEXT DEFAULT 'unclear',
  verification_method TEXT DEFAULT 'forward',
  agent_card_enabled BOOLEAN DEFAULT false,
  agent_card_limit_transaction INT DEFAULT 5000,
  agent_card_limit_monthly INT DEFAULT 20000,
  virtual_phone TEXT,
  preferred_device TEXT DEFAULT 'cloud',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users insert own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages settings" ON user_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 5. Scheduled Tasks Table
-- =====================================================

CREATE TABLE IF NOT EXISTS public.scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_template TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  description TEXT,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at) WHERE is_active = true;

ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own scheduled tasks" ON scheduled_tasks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users manage own scheduled tasks" ON scheduled_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages scheduled tasks" ON scheduled_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 6. Add preferred_device to profiles if not exists
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'preferred_device'
  ) THEN
    ALTER TABLE profiles ADD COLUMN preferred_device TEXT DEFAULT 'cloud';
  END IF;
END $$;

-- =====================================================
-- 7. UNIQUE constraint on profiles.twilio_number
-- =====================================================
-- Partial index allows multiple NULLs (users without numbers)
-- while preventing two users from sharing the same Twilio number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_twilio_number_unique
  ON profiles(twilio_number) WHERE twilio_number IS NOT NULL;

-- =====================================================
-- 8. Agent Cards Table (privacy-card.ts references this)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  card_token_encrypted TEXT,
  last_four VARCHAR(4) NOT NULL,
  balance_cents INT NOT NULL DEFAULT 0,
  is_frozen BOOLEAN NOT NULL DEFAULT false,
  per_tx_limit_cents INT DEFAULT 5000,
  monthly_limit_cents INT DEFAULT 20000,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One card per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cards_user_unique
  ON agent_cards(user_id);

ALTER TABLE agent_cards ENABLE ROW LEVEL SECURITY;

-- Users can view their own card
CREATE POLICY "Users view own card" ON agent_cards
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own card
CREATE POLICY "Users insert own card" ON agent_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own card
CREATE POLICY "Users update own card" ON agent_cards
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own card
CREATE POLICY "Users delete own card" ON agent_cards
  FOR DELETE USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role manages agent cards" ON agent_cards
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- 9. Atomic RPCs for card balance operations
-- =====================================================

-- Increment balance (funding)
CREATE OR REPLACE FUNCTION increment_card_balance(p_card_id UUID, p_amount INT)
RETURNS TABLE(balance_cents INT) AS $$
BEGIN
  RETURN QUERY
  UPDATE agent_cards
    SET balance_cents = agent_cards.balance_cents + p_amount
    WHERE id = p_card_id
    RETURNING agent_cards.balance_cents;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deduct balance (purchase) — fails if insufficient
CREATE OR REPLACE FUNCTION deduct_card_balance(p_card_id UUID, p_amount INT)
RETURNS TABLE(balance_cents INT) AS $$
BEGIN
  RETURN QUERY
  UPDATE agent_cards
    SET balance_cents = agent_cards.balance_cents - p_amount
    WHERE id = p_card_id
      AND agent_cards.balance_cents >= p_amount
    RETURNING agent_cards.balance_cents;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance or card not found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
