-- Migration v40: Cost protection — daily SMS limit and MONITOR job cap per user
-- Prevents proactive monitoring runaway (3,821 tasks/day incident on 2026-03-05)

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS daily_sms_limit INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_monitor_jobs INTEGER DEFAULT 3;

COMMENT ON COLUMN user_settings.daily_sms_limit IS 'Max proactive/monitoring SMS per day. Default 15. Resets at midnight UTC.';
COMMENT ON COLUMN user_settings.max_monitor_jobs IS 'Max concurrent MONITOR: background jobs. Default 3.';
