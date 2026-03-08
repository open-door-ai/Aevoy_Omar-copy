-- v45: Add master_timeout_minutes to user_settings for dynamic task timeouts
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS master_timeout_minutes integer DEFAULT 15;

-- Add comment for documentation
COMMENT ON COLUMN user_settings.master_timeout_minutes IS 'Max minutes a single task can run before force-completing. Default 15, max 480 (8 hours).';
COMMENT ON COLUMN user_settings.task_budget_cents IS 'Max cost in cents for a single task. Default 500 ($5.00), max 5000 ($50.00).';
