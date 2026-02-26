-- Migration v37: Full Send Mode
-- Enables autonomous email management with priority-based auto-reply and auto-credentials

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS full_send_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS full_send_auto_reply BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS full_send_draft_threshold TEXT NOT NULL DEFAULT 'medium'; -- 'all' | 'medium' | 'high'

-- Update the auto-init trigger to include full_send_mode defaults on new user signup
-- (The trigger in migration_v35 already uses INSERT ... ON CONFLICT DO NOTHING, so new columns
--  get their DEFAULT values automatically when a new row is inserted.)

COMMENT ON COLUMN user_settings.full_send_mode IS 'When true, agent autonomously handles incoming emails by priority without user intervention';
COMMENT ON COLUMN user_settings.full_send_auto_reply IS 'When true, agent sends auto-replies for low/medium priority emails in full send mode';
COMMENT ON COLUMN user_settings.full_send_draft_threshold IS 'Priority threshold for auto-drafting/sending replies: all | medium | high';
