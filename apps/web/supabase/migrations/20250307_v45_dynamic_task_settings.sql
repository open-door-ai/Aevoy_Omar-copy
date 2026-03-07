-- v45: Add master_timeout_minutes to user_settings for dynamic task timeouts
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS master_timeout_minutes integer DEFAULT 15;
