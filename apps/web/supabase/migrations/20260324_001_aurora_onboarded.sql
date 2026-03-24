-- Add aurora_onboarded flag to user_settings
-- Tracks whether a user has seen the Aurora inline welcome
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS aurora_onboarded BOOLEAN DEFAULT false;
