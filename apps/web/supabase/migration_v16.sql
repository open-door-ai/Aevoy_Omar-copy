-- Migration v16: Autonomous AI Employee System
-- Purpose: Enable fully autonomous skill installation, OAuth acquisition, iterative search, parallel execution
-- Created: 2026-02-07

-- ============================================================================
-- AUTONOMOUS SKILLS SYSTEM
-- ============================================================================

-- Installed skills tracking (per user)
CREATE TABLE IF NOT EXISTS public.installed_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  manifest JSONB NOT NULL,
  security_score INTEGER NOT NULL CHECK (security_score >= 0 AND security_score <= 100),
  audit_report JSONB,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(user_id, skill_id)
);

CREATE INDEX idx_installed_skills_user ON public.installed_skills(user_id, installed_at DESC);
CREATE INDEX idx_installed_skills_score ON public.installed_skills(security_score) WHERE security_score < 90;

COMMENT ON TABLE public.installed_skills IS 'Tracks autonomously installed skills per user with security audit results';
COMMENT ON COLUMN public.installed_skills.security_score IS 'AI-powered security audit score (0-100), must be >=90 to install';

-- ============================================================================
-- ITERATIVE DEEPENING SYSTEM
-- ============================================================================

-- Iteration results (for tasks that use iterative deepening)
CREATE TABLE IF NOT EXISTS public.iteration_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL,
  result_data JSONB,
  cost_usd NUMERIC(10,4),
  actions_count INTEGER,
  screenshot TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, iteration_number)
);

CREATE INDEX idx_iteration_results_task ON public.iteration_results(task_id, iteration_number);

COMMENT ON TABLE public.iteration_results IS 'Stores results from each iteration of iterative deepening tasks (e.g., hotel price comparison)';

-- ============================================================================
-- AUTONOMOUS OAUTH ACQUISITION
-- ============================================================================

-- OAuth acquisition audit log
CREATE TABLE IF NOT EXISTS public.autonomous_oauth_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  scopes TEXT[],
  acquisition_method TEXT CHECK (acquisition_method IN ('browser_automation', 'existing_session', 'manual_fallback')),
  success BOOLEAN NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_oauth_log_user ON public.autonomous_oauth_log(user_id, created_at DESC);
CREATE INDEX idx_oauth_log_success ON public.autonomous_oauth_log(success, created_at DESC);

COMMENT ON TABLE public.autonomous_oauth_log IS 'Audit log for autonomous OAuth acquisition attempts via browser automation';

-- ============================================================================
-- FREE TRIAL SIGNUPS
-- ============================================================================

-- Free trial API service signups
CREATE TABLE IF NOT EXISTS public.free_trial_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('gemini', 'deepseek', 'groq', 'other')),
  api_key_encrypted TEXT,
  signed_up_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, service)
);

CREATE INDEX idx_free_trial_user ON public.free_trial_signups(user_id, is_active);

COMMENT ON TABLE public.free_trial_signups IS 'Tracks autonomous free trial signups (Gemini, DeepSeek, etc.) - never enters payment info';

-- ============================================================================
-- AUTONOMOUS SETTINGS (extend user_settings)
-- ============================================================================

-- Add autonomous feature toggles to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS auto_install_skills BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_acquire_oauth BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_signup_free_trial BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS parallel_execution BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS iterative_deepening BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(10,2) DEFAULT 15.00 CHECK (monthly_budget >= 5 AND monthly_budget <= 100);

COMMENT ON COLUMN public.user_settings.auto_install_skills IS 'Allow AI to autonomously install skills from registry';
COMMENT ON COLUMN public.user_settings.auto_acquire_oauth IS 'Allow AI to autonomously acquire OAuth via browser automation';
COMMENT ON COLUMN public.user_settings.auto_signup_free_trial IS 'Allow AI to sign up for free API services (no payment info)';
COMMENT ON COLUMN public.user_settings.parallel_execution IS 'Allow AI to run multiple browser sessions in parallel';
COMMENT ON COLUMN public.user_settings.iterative_deepening IS 'Allow AI to iteratively search for best results';
COMMENT ON COLUMN public.user_settings.monthly_budget IS 'Maximum AI can spend autonomously per month ($5-$100)';

-- ============================================================================
-- TASK EXTENSIONS (add autonomous fields)
-- ============================================================================

-- Add autonomous execution tracking to tasks table
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS is_iterative BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS iteration_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS convergence_data JSONB,
  ADD COLUMN IF NOT EXISTS is_parallel BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS parallel_count INTEGER DEFAULT 0;

COMMENT ON COLUMN public.tasks.is_iterative IS 'Whether this task used iterative deepening';
COMMENT ON COLUMN public.tasks.iteration_count IS 'Number of iterations completed';
COMMENT ON COLUMN public.tasks.is_parallel IS 'Whether this task used parallel execution';
COMMENT ON COLUMN public.tasks.parallel_count IS 'Number of parallel browser sessions used';

-- ============================================================================
-- ERROR LOGGING (for structured error tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'critical')),
  message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_error_logs_level ON public.error_logs(level, created_at DESC);
CREATE INDEX idx_error_logs_time ON public.error_logs(created_at DESC);

COMMENT ON TABLE public.error_logs IS 'Structured error logging for debugging and monitoring';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.installed_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iteration_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autonomous_oauth_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_trial_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- installed_skills policies
CREATE POLICY "Users can view their own installed skills"
  ON public.installed_skills FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to installed skills"
  ON public.installed_skills FOR ALL
  USING (auth.role() = 'service_role');

-- iteration_results policies
CREATE POLICY "Users can view their own iteration results"
  ON public.iteration_results FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM tasks WHERE id = task_id));

CREATE POLICY "Service role full access to iteration results"
  ON public.iteration_results FOR ALL
  USING (auth.role() = 'service_role');

-- autonomous_oauth_log policies
CREATE POLICY "Users can view their own OAuth log"
  ON public.autonomous_oauth_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to OAuth log"
  ON public.autonomous_oauth_log FOR ALL
  USING (auth.role() = 'service_role');

-- free_trial_signups policies
CREATE POLICY "Users can view their own free trial signups"
  ON public.free_trial_signups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to free trial signups"
  ON public.free_trial_signups FOR ALL
  USING (auth.role() = 'service_role');

-- error_logs policies (service role only)
CREATE POLICY "Service role full access to error logs"
  ON public.error_logs FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get user's autonomous settings
CREATE OR REPLACE FUNCTION get_autonomous_settings(p_user_id UUID)
RETURNS TABLE (
  auto_install_skills BOOLEAN,
  auto_acquire_oauth BOOLEAN,
  auto_signup_free_trial BOOLEAN,
  parallel_execution BOOLEAN,
  iterative_deepening BOOLEAN,
  monthly_budget NUMERIC
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    us.auto_install_skills,
    us.auto_acquire_oauth,
    us.auto_signup_free_trial,
    us.parallel_execution,
    us.iterative_deepening,
    us.monthly_budget
  FROM user_settings us
  WHERE us.user_id = p_user_id;
END;
$$;

-- Check if skill is already installed
CREATE OR REPLACE FUNCTION is_skill_installed(p_user_id UUID, p_skill_id TEXT)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  skill_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM installed_skills
    WHERE user_id = p_user_id AND skill_id = p_skill_id
  ) INTO skill_exists;

  RETURN skill_exists;
END;
$$;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT ON public.installed_skills TO authenticated;
GRANT SELECT ON public.iteration_results TO authenticated;
GRANT SELECT ON public.autonomous_oauth_log TO authenticated;
GRANT SELECT ON public.free_trial_signups TO authenticated;

GRANT ALL ON public.installed_skills TO service_role;
GRANT ALL ON public.iteration_results TO service_role;
GRANT ALL ON public.autonomous_oauth_log TO service_role;
GRANT ALL ON public.free_trial_signups TO service_role;
GRANT ALL ON public.error_logs TO service_role;
