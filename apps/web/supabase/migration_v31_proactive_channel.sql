-- Migration v31: Proactive notification channel preference
-- Users can choose which channel receives proactive alerts: sms, email, telegram, whatsapp, voice

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS proactive_channel TEXT DEFAULT 'sms'
    CHECK (proactive_channel IN ('sms', 'email', 'telegram', 'whatsapp', 'voice'));

-- Also add proactive_enabled toggle to user_settings (was only on profiles)
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS proactive_enabled BOOLEAN DEFAULT true;

COMMENT ON COLUMN user_settings.proactive_channel IS 'Preferred channel for proactive notifications: sms, email, telegram, whatsapp, voice';
COMMENT ON COLUMN user_settings.proactive_enabled IS 'Whether proactive outbound alerts are enabled for this user';
