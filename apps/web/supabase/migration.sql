-- Handlit Database Migration
-- Run this in Supabase SQL Editor

-- =====================================================
-- 1. Create profiles table
-- =====================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  timezone TEXT DEFAULT 'America/Los_Angeles',
  subscription_tier TEXT DEFAULT 'free',
  messages_used INT DEFAULT 0,
  messages_limit INT DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);

-- =====================================================
-- 2. Create tasks table
-- =====================================================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  type TEXT,
  email_subject TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  tokens_used INT DEFAULT 0,
  cost_usd DECIMAL(10,6) DEFAULT 0,
  error_message TEXT
);

-- =====================================================
-- 3. Create scheduled_tasks table
-- =====================================================
CREATE TABLE public.scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'America/Los_Angeles',
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  run_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. Create indexes
-- =====================================================
CREATE UNIQUE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_scheduled_tasks_user ON scheduled_tasks(user_id);
CREATE INDEX idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);

-- =====================================================
-- 5. Enable Row Level Security
-- =====================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 6. Create RLS Policies
-- =====================================================

-- Profiles: users can view and update their own profile
CREATE POLICY "Users view own profile" ON profiles 
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles 
  FOR UPDATE USING (auth.uid() = id);

-- Tasks: users can view their own tasks
CREATE POLICY "Users view own tasks" ON tasks 
  FOR SELECT USING (auth.uid() = user_id);

-- Scheduled tasks: users can manage their own scheduled tasks
CREATE POLICY "Users manage own scheduled" ON scheduled_tasks 
  FOR ALL USING (auth.uid() = user_id);

-- =====================================================
-- 7. Create trigger for auto-creating profile on signup
-- =====================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username)
  VALUES (
    NEW.id,
    NEW.email,
    LOWER(REGEXP_REPLACE(SPLIT_PART(NEW.email, '@', 1), '[^a-z0-9]', '', 'g'))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =====================================================
-- 8. Create function to increment usage
-- =====================================================
CREATE OR REPLACE FUNCTION increment_usage(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET messages_used = messages_used + 1, last_active_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 9. Create function to check if user is over quota
-- =====================================================
CREATE OR REPLACE FUNCTION check_quota(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_used INT;
  v_limit INT;
BEGIN
  SELECT messages_used, messages_limit INTO v_used, v_limit
  FROM profiles
  WHERE id = p_user_id;
  
  RETURN v_used < v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 10. Service role policies for agent server
-- =====================================================
-- These allow the agent server (using service role key) to insert/update tasks

CREATE POLICY "Service role can insert tasks" ON tasks
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update tasks" ON tasks
  FOR UPDATE
  USING (true);

CREATE POLICY "Service role can insert profiles" ON profiles
  FOR INSERT
  WITH CHECK (true);
