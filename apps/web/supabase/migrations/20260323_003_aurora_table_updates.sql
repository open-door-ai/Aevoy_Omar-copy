-- Aurora: Update existing tables with new columns
-- Migration: 20260323_003_aurora_table_updates
-- Adds Aurora-specific columns to user_settings and tasks

-- Add Aurora-specific columns to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS morning_checkin_time TIME DEFAULT '09:00';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS evening_checkin_time TIME;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS autonomous_mode BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS humor_level TEXT DEFAULT 'high'
    CHECK (humor_level IN ('low', 'medium', 'high'));
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS daily_spend_cap_cents INTEGER DEFAULT 300;

-- Add context tracking to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS aurora_context_extracted BOOLEAN DEFAULT false;
