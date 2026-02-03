-- Aevoy Database Migration V3
-- Run this in Supabase SQL Editor AFTER migration_v2.sql
-- Adds: action_history, transactions, prepaid_cards, profile columns, memory embedding, indexes

-- =====================================================
-- 1. Action History Table (Undo system)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.action_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_data JSONB NOT NULL DEFAULT '{}',
  undo_data JSONB,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_history_task ON action_history(task_id);
CREATE INDEX IF NOT EXISTS idx_action_history_user ON action_history(user_id, created_at DESC);

ALTER TABLE action_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own action history" ON action_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role manages action history" ON action_history
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 2. Transactions Table (Purchase tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  amount_cents INT NOT NULL,
  merchant TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending', -- pending, completed, failed, refunded
  card_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_task ON transactions(task_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role manages transactions" ON transactions
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 3. Prepaid Cards Table (Stub — deferred)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.prepaid_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  provider TEXT DEFAULT 'stripe',
  card_token_encrypted TEXT,
  last_four VARCHAR(4),
  balance_cents INT DEFAULT 0,
  per_tx_limit_cents INT DEFAULT 5000,    -- $50 default
  monthly_limit_cents INT DEFAULT 20000,  -- $200 default
  is_frozen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prepaid_cards_user ON prepaid_cards(user_id);

ALTER TABLE prepaid_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own cards" ON prepaid_cards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role manages cards" ON prepaid_cards
  FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 4. Update profiles table: add missing columns
-- =====================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS twilio_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS proactive_enabled BOOLEAN DEFAULT FALSE;

-- =====================================================
-- 5. Update user_memory: support multiple entries per user + memory types
-- =====================================================
-- Drop the unique constraint on user_id if it exists (v2 had UNIQUE on user_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_memory_user_id_key'
  ) THEN
    ALTER TABLE user_memory DROP CONSTRAINT user_memory_user_id_key;
  END IF;
END $$;

-- Add memory_type column if not exists
ALTER TABLE user_memory
  ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'working',
  ADD COLUMN IF NOT EXISTS importance DECIMAL(3,2) DEFAULT 0.5;

-- Add embedding column for similarity search (requires pgvector extension)
-- Note: Run 'CREATE EXTENSION IF NOT EXISTS vector;' first if not enabled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_memory' AND column_name = 'embedding'
  ) THEN
    -- Try to add vector column; skip if pgvector not installed
    BEGIN
      EXECUTE 'ALTER TABLE user_memory ADD COLUMN embedding vector(1536)';
    EXCEPTION WHEN undefined_object THEN
      RAISE NOTICE 'pgvector extension not installed, skipping embedding column';
    END;
  END IF;
END $$;

-- Create index for memory lookups
CREATE INDEX IF NOT EXISTS idx_user_memory_type ON user_memory(user_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_user_memory_importance ON user_memory(user_id, importance DESC);

-- =====================================================
-- 6. Add missing columns to tasks table
-- =====================================================
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS input_channel TEXT DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS verification_status TEXT,
  ADD COLUMN IF NOT EXISTS verification_data JSONB;

-- =====================================================
-- 7. Additional indexes for performance
-- =====================================================
-- Failure memory indexes (may already exist from v2, IF NOT EXISTS handles it)
CREATE INDEX IF NOT EXISTS idx_failure_memory_domain_action ON failure_memory(site_domain, action_type);

-- Usage indexes
CREATE INDEX IF NOT EXISTS idx_usage_user_month_v3 ON usage(user_id, month);

-- Tasks by channel
CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(user_id, input_channel);

-- =====================================================
-- 8. Timestamp update triggers for new tables
-- =====================================================
-- update_updated_at function should already exist from v2 migration
-- Add triggers for new tables that don't have them

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_transactions_updated_at'
  ) THEN
    -- Transactions don't have updated_at, skip
    NULL;
  END IF;
END $$;

-- =====================================================
-- 9. Function to record action for undo system
-- =====================================================
CREATE OR REPLACE FUNCTION record_action(
  p_task_id UUID,
  p_user_id UUID,
  p_action_type TEXT,
  p_action_data JSONB,
  p_undo_data JSONB DEFAULT NULL,
  p_screenshot_url TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO action_history (task_id, user_id, action_type, action_data, undo_data, screenshot_url)
  VALUES (p_task_id, p_user_id, p_action_type, p_action_data, p_undo_data, p_screenshot_url)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 10. Function to track voice/SMS usage
-- =====================================================
CREATE OR REPLACE FUNCTION track_voice_sms_usage(
  p_user_id UUID,
  p_sms_count INTEGER DEFAULT 0,
  p_voice_minutes INTEGER DEFAULT 0
)
RETURNS VOID AS $$
DECLARE
  v_month VARCHAR(7);
BEGIN
  v_month := TO_CHAR(NOW(), 'YYYY-MM');

  INSERT INTO usage (user_id, month, sms_count, voice_minutes)
  VALUES (p_user_id, v_month, p_sms_count, p_voice_minutes)
  ON CONFLICT (user_id, month)
  DO UPDATE SET
    sms_count = usage.sms_count + p_sms_count,
    voice_minutes = usage.voice_minutes + p_voice_minutes,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
