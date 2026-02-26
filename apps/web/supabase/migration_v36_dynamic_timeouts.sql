-- Dynamic timeout settings for user_settings table
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS clarification_timeout_ms INTEGER DEFAULT 1200000, -- 20 min default
  ADD COLUMN IF NOT EXISTS monitoring_interval_ms INTEGER DEFAULT 900000,     -- 15 min default
  ADD COLUMN IF NOT EXISTS max_task_iterations INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS task_budget_cents INTEGER DEFAULT 500,              -- $5 default
  ADD COLUMN IF NOT EXISTS response_channel TEXT DEFAULT 'email';              -- preferred channel for responses
