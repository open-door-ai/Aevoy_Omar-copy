-- Migration v29: OpenRouter developer settings

-- 1. Add OpenRouter columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS openrouter_api_key TEXT,            -- AES-256-GCM encrypted API key
  ADD COLUMN IF NOT EXISTS openrouter_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS openrouter_model_preset TEXT DEFAULT 'auto';
-- Presets: 'auto' | 'free' | 'quality' | 'balanced' | 'custom'

-- 2. Comment for audit trail
COMMENT ON COLUMN user_settings.openrouter_api_key IS 'AES-256-GCM encrypted OpenRouter API key, IV prepended as hex';
COMMENT ON COLUMN user_settings.openrouter_enabled IS 'Whether to route AI calls through OpenRouter for this user';
COMMENT ON COLUMN user_settings.openrouter_model_preset IS 'Model preset: auto, free, quality, balanced, custom';
