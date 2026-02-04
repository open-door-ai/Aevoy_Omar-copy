-- Migration V6: Onboarding system columns
-- Run this in Supabase Dashboard SQL Editor

-- Onboarding tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_interview_status TEXT DEFAULT 'pending';

-- User preferences from onboarding
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_checkin_enabled BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_checkin_time TIME DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS main_uses TEXT[] DEFAULT '{}';

-- User settings table (if not exists)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  confirmation_mode TEXT DEFAULT 'unclear',
  verification_method TEXT DEFAULT 'forward',
  agent_card_enabled BOOLEAN DEFAULT false,
  agent_card_limit_transaction INTEGER DEFAULT 5000,
  agent_card_limit_monthly INTEGER DEFAULT 20000,
  virtual_phone VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update own settings"
  ON user_settings FOR ALL
  USING (auth.uid() = user_id);

-- Agent cards table (if not exists)
CREATE TABLE IF NOT EXISTS agent_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT,
  last_four VARCHAR(4),
  balance_cents INTEGER DEFAULT 0,
  is_frozen BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agent_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can read own card"
  ON agent_cards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can manage own card"
  ON agent_cards FOR ALL
  USING (auth.uid() = user_id);
